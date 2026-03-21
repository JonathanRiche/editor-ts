//! Codex provider harness backed by `codex app-server`.

const std = @import("std");
const provider_types = @import("../provider_types.zig");

const log = std.log.scoped(.native_codex);

const OVERLOAD_ERROR_CODE = -32001;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_WS_URL = "ws://127.0.0.1:4500";
const MAX_WS_MESSAGE_BYTES = 1024 * 1024;
const MAX_HTTP_LINE_BYTES = 16 * 1024;
const MAX_RPC_RETRIES = 4;

pub const Transport = enum(u8) {
    websocket,
    stdio_jsonl,
};

pub const Config = struct {
    executable: []const u8 = "codex",
    cwd: ?[]const u8 = null,
    transport: Transport = .websocket,
    websocket_url: ?[]const u8 = DEFAULT_WS_URL,
    launch_on_connect: bool = true,
};

pub const Client = struct {
    allocator: std.mem.Allocator,
    config: Config,
    child: ?std.process.Child = null,
    owns_child: bool = false,
    stream: ?std.net.Stream = null,
    initialized: bool = false,
    next_request_id: u64 = 1,
    loaded_threads: std.StringHashMap(void),

    pub fn init(allocator: std.mem.Allocator, config: Config) !Client {
        var client: Client = .{
            .allocator = allocator,
            .config = config,
            .loaded_threads = std.StringHashMap(void).init(allocator),
        };
        try client.ensureConnected();
        return client;
    }

    pub fn deinit(self: *Client) void {
        self.closeConnection();
        self.freeLoadedThreads();
        self.loaded_threads.deinit();
    }

    pub fn authState(self: *Client) !provider_types.AuthState {
        try self.ensureConnected();

        const params = .{ .refreshToken = false };
        const payload = try self.callRpcForResultAlloc("account/read", params);
        defer self.allocator.free(payload);

        var parsed = try std.json.parseFromSlice(std.json.Value, self.allocator, payload, .{});
        defer parsed.deinit();

        const account = getObjectField(parsed.value, "account") orelse return .signed_out;
        return switch (account) {
            .null => .signed_out,
            .object => .signed_in,
            else => .unknown,
        };
    }

    pub fn listThreads(self: *Client, allocator: std.mem.Allocator) ![]provider_types.ChatThreadSummary {
        try self.ensureConnected();

        const params = .{
            .limit = 50,
        };
        const payload = try self.callRpcForResultAlloc("thread/list", params);
        defer self.allocator.free(payload);

        var parsed = try std.json.parseFromSlice(std.json.Value, self.allocator, payload, .{});
        defer parsed.deinit();

        const threads_value = getObjectField(parsed.value, "threads") orelse return allocator.alloc(provider_types.ChatThreadSummary, 0);
        if (threads_value != .array) {
            return allocator.alloc(provider_types.ChatThreadSummary, 0);
        }

        var threads: std.ArrayList(provider_types.ChatThreadSummary) = .empty;
        defer threads.deinit(allocator);

        for (threads_value.array.items) |item| {
            if (item != .object) continue;
            const id_value = item.object.get("id") orelse continue;
            const id = stringValue(id_value) orelse continue;
            const title = getOptionalObjectString(item, "title") orelse id;

            try threads.append(allocator, .{
                .id = try allocator.dupe(u8, id),
                .title = try allocator.dupe(u8, title),
            });
        }

        return threads.toOwnedSlice(allocator);
    }

    pub fn sendPrompt(
        self: *Client,
        allocator: std.mem.Allocator,
        request: provider_types.SendPromptRequest,
    ) !provider_types.SendPromptResult {
        try self.ensureConnected();

        const thread_id = if (request.thread_id) |existing|
            try allocator.dupe(u8, existing)
        else
            try self.startThread(allocator, request.cwd, request.model);
        errdefer allocator.free(thread_id);

        try self.ensureThreadLoaded(thread_id);

        const reply = try self.startTurnAndCollectReply(allocator, thread_id, request);
        errdefer allocator.free(reply);

        return .{
            .thread_id = thread_id,
            .reply_text = reply,
        };
    }

    fn ensureConnected(self: *Client) !void {
        if (self.stream == null) {
            switch (self.config.transport) {
                .websocket => try self.connectWebSocket(),
                .stdio_jsonl => return error.TransportNotImplemented,
            }
        }

        if (!self.initialized) {
            try self.initializeProtocol();
        }
    }

    fn closeConnection(self: *Client) void {
        if (self.stream) |stream| {
            self.writeCloseFrame(stream) catch {};
            stream.close();
            self.stream = null;
        }

        self.initialized = false;

        if (self.child) |*child| {
            if (self.owns_child) {
                _ = child.kill() catch {};
                _ = child.wait() catch {};
            }
            self.child = null;
            self.owns_child = false;
        }
    }

    fn connectWebSocket(self: *Client) !void {
        const raw_url = self.config.websocket_url orelse return error.MissingWebSocketUrl;
        const uri = try std.Uri.parse(raw_url);
        const host = try uri.getHostAlloc(self.allocator);
        defer if (uri.host != null and host.ptr != switch (uri.host.?) {
            .raw => |raw| raw.ptr,
            .percent_encoded => |encoded| encoded.ptr,
        }) self.allocator.free(host);

        if (!std.ascii.eqlIgnoreCase(uri.scheme, "ws")) {
            return error.UnsupportedWebSocketScheme;
        }

        if (self.config.launch_on_connect) {
            try self.spawnWebSocketServer(raw_url);
        }

        const port = uri.port orelse 80;
        const stream = try self.connectWithRetry(host, port);
        errdefer stream.close();

        try self.performWebSocketHandshake(stream, uri, host, port);
        self.stream = stream;
    }

    fn spawnWebSocketServer(self: *Client, url: []const u8) !void {
        if (self.child != null) return;

        var argv = [_][]const u8{
            self.config.executable,
            "app-server",
            "--listen",
            url,
        };

        var child = std.process.Child.init(argv[0..], self.allocator);
        child.stdin_behavior = .Ignore;
        child.stdout_behavior = .Ignore;
        child.stderr_behavior = .Ignore;
        child.cwd = self.config.cwd;
        try child.spawn();
        child.argv = &.{};

        self.child = child;
        self.owns_child = true;
    }

    fn connectWithRetry(self: *Client, host: []const u8, port: u16) !std.net.Stream {
        var attempt: usize = 0;
        while (true) : (attempt += 1) {
            const result = std.net.tcpConnectToHost(self.allocator, host, port);
            if (result) |stream| {
                return stream;
            } else |err| {
                if (!self.owns_child or attempt >= 29) {
                    return err;
                }

                const backoff_ms: u64 = @min(@as(u64, 50) * (@as(u64, 1) << @intCast(@min(attempt, 5))), 800);
                std.Thread.sleep(backoff_ms * @as(u64, std.time.ns_per_ms));
            }
        }
    }

    fn performWebSocketHandshake(
        self: *Client,
        stream: std.net.Stream,
        uri: std.Uri,
        host: []const u8,
        port: u16,
    ) !void {
        var nonce: [16]u8 = undefined;
        std.crypto.random.bytes(&nonce);

        const key = try encodeBase64Alloc(self.allocator, &nonce);
        defer self.allocator.free(key);

        const accept_expected = try computeAcceptKeyAlloc(self.allocator, key);
        defer self.allocator.free(accept_expected);

        const host_header = if (port == 80)
            try self.allocator.dupe(u8, host)
        else
            try std.fmt.allocPrint(self.allocator, "{s}:{d}", .{ host, port });
        defer self.allocator.free(host_header);

        const request_target = try buildRequestTargetAlloc(self.allocator, uri);
        defer self.allocator.free(request_target);

        const request = try std.fmt.allocPrint(
            self.allocator,
            "GET {s} HTTP/1.1\r\nHost: {s}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {s}\r\nSec-WebSocket-Version: 13\r\n\r\n",
            .{ request_target, host_header, key },
        );
        defer self.allocator.free(request);

        try stream.writeAll(request);

        const status_line = try readHttpLineAlloc(self.allocator, stream);
        defer self.allocator.free(status_line);
        if (!std.mem.startsWith(u8, status_line, "HTTP/1.1 101")) {
            return error.WebSocketUpgradeRejected;
        }

        var accept_header: ?[]u8 = null;
        defer if (accept_header) |line| self.allocator.free(line);

        while (true) {
            const line = try readHttpLineAlloc(self.allocator, stream);
            if (line.len == 0) {
                self.allocator.free(line);
                break;
            }

            if (std.ascii.startsWithIgnoreCase(line, "sec-websocket-accept:")) {
                accept_header = line;
            } else {
                self.allocator.free(line);
            }
        }

        const accept_line = accept_header orelse return error.MissingWebSocketAccept;
        const colon_index = std.mem.indexOfScalar(u8, accept_line, ':') orelse return error.MissingWebSocketAccept;
        const accept_value = std.mem.trim(u8, accept_line[colon_index + 1 ..], " \t");
        if (!std.mem.eql(u8, accept_value, accept_expected)) {
            return error.WebSocketAcceptMismatch;
        }
    }

    fn initializeProtocol(self: *Client) !void {
        const params = .{
            .clientInfo = .{
                .name = "editorts_native",
                .title = "EditorTs Native",
                .version = "0.1.0",
            },
            .capabilities = .{
                .experimentalApi = true,
            },
        };

        const payload = try self.callRpcForResultAlloc("initialize", params);
        self.allocator.free(payload);

        try self.sendNotification("initialized", .{});
        self.initialized = true;
    }

    fn startThread(
        self: *Client,
        allocator: std.mem.Allocator,
        cwd: ?[]const u8,
        model: ?[]const u8,
    ) ![]u8 {
        const payload = if (cwd) |working_dir|
            if (model) |selected_model|
                try self.callRpcForResultAlloc("thread/start", .{ .cwd = working_dir, .model = selected_model })
            else
                try self.callRpcForResultAlloc("thread/start", .{ .cwd = working_dir })
        else if (model) |selected_model|
            try self.callRpcForResultAlloc("thread/start", .{ .model = selected_model })
        else
            try self.callRpcForResultAlloc("thread/start", .{});
        defer self.allocator.free(payload);

        var parsed = try std.json.parseFromSlice(std.json.Value, self.allocator, payload, .{});
        defer parsed.deinit();

        const thread = getObjectField(parsed.value, "thread") orelse return error.MissingThreadId;
        const id = getOptionalObjectString(thread, "id") orelse return error.MissingThreadId;
        try self.rememberLoadedThread(id);
        return allocator.dupe(u8, id);
    }

    fn ensureThreadLoaded(self: *Client, thread_id: []const u8) !void {
        if (self.loaded_threads.contains(thread_id)) return;

        const params = .{
            .threadId = thread_id,
        };
        const payload = try self.callRpcForResultAlloc("thread/resume", params);
        defer self.allocator.free(payload);

        try self.rememberLoadedThread(thread_id);
    }

    fn rememberLoadedThread(self: *Client, thread_id: []const u8) !void {
        const owned = try self.allocator.dupe(u8, thread_id);
        errdefer self.allocator.free(owned);

        const gop = try self.loaded_threads.getOrPut(owned);
        if (gop.found_existing) {
            self.allocator.free(owned);
            return;
        }
        gop.value_ptr.* = {};
    }

    fn startTurnAndCollectReply(
        self: *Client,
        allocator: std.mem.Allocator,
        thread_id: []const u8,
        request: provider_types.SendPromptRequest,
    ) ![]u8 {
        const request_id = try self.sendTurnStartRequest(thread_id, request);
        var turn_started = false;
        var reply: std.ArrayList(u8) = .empty;
        defer reply.deinit(allocator);

        while (true) {
            const message = try self.readTextMessageAlloc(self.allocator);
            defer self.allocator.free(message);

            var parsed = try std.json.parseFromSlice(std.json.Value, self.allocator, message, .{});
            defer parsed.deinit();

            const root = parsed.value;
            if (try self.maybeHandleMatchingResponse(root, request_id)) {
                turn_started = true;
                continue;
            }

            if (!turn_started) continue;

            if (try appendNotificationDelta(root, allocator, &reply)) {
                if (request.on_stream_delta) |on_stream_delta| {
                    if (extractNotificationDelta(root)) |delta| {
                        on_stream_delta(request.stream_context, delta);
                    }
                }
                continue;
            }

            if (isTurnCompleted(root)) {
                break;
            }
        }

        return reply.toOwnedSlice(allocator);
    }

    fn sendTurnStartRequest(
        self: *Client,
        thread_id: []const u8,
        request: provider_types.SendPromptRequest,
    ) !u64 {
        const id = self.next_request_id;
        self.next_request_id += 1;

        var writer: std.Io.Writer.Allocating = .init(self.allocator);
        defer writer.deinit();

        var stringify: std.json.Stringify = .{
            .writer = &writer.writer,
            .options = .{},
        };

        try stringify.beginObject();
        try stringify.objectField("method");
        try stringify.write("turn/start");
        try stringify.objectField("id");
        try stringify.write(id);
        try stringify.objectField("params");
        try stringify.beginObject();
        try stringify.objectField("threadId");
        try stringify.write(thread_id);
        if (request.cwd) |working_dir| {
            try stringify.objectField("cwd");
            try stringify.write(working_dir);
        }
        if (request.model) |selected_model| {
            try stringify.objectField("model");
            try stringify.write(selected_model);
        }
        if (request.reasoning_effort) |effort| {
            try stringify.objectField("effort");
            try stringify.write(effort);
        }
        try stringify.objectField("input");
        try stringify.beginArray();
        try stringify.beginObject();
        try stringify.objectField("type");
        try stringify.write("text");
        try stringify.objectField("text");
        try stringify.write(request.prompt);
        try stringify.endObject();
        try stringify.endArray();
        try stringify.endObject();
        try stringify.endObject();

        const payload = try writer.toOwnedSlice();
        defer self.allocator.free(payload);
        try self.writeTextMessage(payload);
        return id;
    }

    fn freeLoadedThreads(self: *Client) void {
        var it = self.loaded_threads.keyIterator();
        while (it.next()) |key_ptr| {
            self.allocator.free(key_ptr.*);
        }
    }

    fn sendNotification(self: *Client, method: []const u8, params: anytype) !void {
        const message = .{
            .method = method,
            .params = params,
        };
        const payload = try stringifyAlloc(self.allocator, message);
        defer self.allocator.free(payload);
        try self.writeTextMessage(payload);
    }

    fn sendRequest(self: *Client, method: []const u8, params: anytype) !u64 {
        const id = self.next_request_id;
        self.next_request_id += 1;

        const message = .{
            .method = method,
            .id = id,
            .params = params,
        };

        const payload = try stringifyAlloc(self.allocator, message);
        defer self.allocator.free(payload);
        try self.writeTextMessage(payload);
        return id;
    }

    fn callRpcForResultAlloc(self: *Client, method: []const u8, params: anytype) ![]u8 {
        var attempt: usize = 0;
        while (true) : (attempt += 1) {
            const id = try self.sendRequest(method, params);
            const maybe_payload = self.awaitResultPayloadAlloc(id);
            if (maybe_payload) |payload| {
                return payload;
            } else |err| switch (err) {
                error.ServerOverloaded => {
                    if (attempt + 1 >= MAX_RPC_RETRIES) return err;
                    const backoff_ms: u64 = @min(@as(u64, 100) * (@as(u64, 1) << @intCast(attempt)), 1500);
                    std.Thread.sleep(backoff_ms * @as(u64, std.time.ns_per_ms));
                    continue;
                },
                else => return err,
            }
        }
    }

    fn awaitResultPayloadAlloc(self: *Client, id: u64) ![]u8 {
        while (true) {
            const message = try self.readTextMessageAlloc(self.allocator);
            errdefer self.allocator.free(message);

            var parsed = try std.json.parseFromSlice(std.json.Value, self.allocator, message, .{});
            defer parsed.deinit();

            const root = parsed.value;
            const response_id = parseMessageId(root) orelse {
                continue;
            };

            if (response_id != id) continue;

            if (getObjectField(root, "error")) |rpc_error| {
                if (getOptionalObjectInteger(rpc_error, "code")) |code| {
                    if (code == OVERLOAD_ERROR_CODE) return error.ServerOverloaded;
                }
                return error.CodexRpcFailed;
            }

            const result = getObjectField(root, "result") orelse return error.MissingRpcResult;
            return try stringifyAlloc(self.allocator, result);
        }
    }

    fn maybeHandleMatchingResponse(self: *Client, root: std.json.Value, id: u64) !bool {
        _ = self;
        const response_id = parseMessageId(root) orelse return false;
        if (response_id != id) return false;

        if (getObjectField(root, "error")) |rpc_error| {
            if (getOptionalObjectInteger(rpc_error, "code")) |code| {
                if (code == OVERLOAD_ERROR_CODE) {
                    return error.ServerOverloaded;
                }
            }
            return error.CodexRpcFailed;
        }

        return true;
    }

    fn writeTextMessage(self: *Client, payload: []const u8) !void {
        const stream = self.stream orelse return error.NotConnected;
        try writeClientFrame(self.allocator, stream, payload, .text);
    }

    fn writeCloseFrame(self: *Client, stream: std.net.Stream) !void {
        try writeClientFrame(self.allocator, stream, "", .connection_close);
    }

    fn readTextMessageAlloc(self: *Client, allocator: std.mem.Allocator) ![]u8 {
        const stream = self.stream orelse return error.NotConnected;

        while (true) {
            const frame = try readServerFrameAlloc(allocator, stream);
            errdefer allocator.free(frame.payload);

            switch (frame.opcode) {
                .pong => {
                    allocator.free(frame.payload);
                    continue;
                },
                .ping => {
                    defer allocator.free(frame.payload);
                    try writeClientFrame(self.allocator, stream, frame.payload, .pong);
                    continue;
                },
                .connection_close => {
                    allocator.free(frame.payload);
                    return error.ConnectionClosed;
                },
                .text => return frame.payload,
                else => {
                    allocator.free(frame.payload);
                    return error.UnexpectedWebSocketFrame;
                },
            }
        }
    }
};

const FrameOpcode = enum(u4) {
    continuation = 0,
    text = 1,
    binary = 2,
    connection_close = 8,
    ping = 9,
    pong = 10,
    _,
};

const Frame = struct {
    opcode: FrameOpcode,
    payload: []u8,
};

fn stringifyAlloc(allocator: std.mem.Allocator, value: anytype) ![]u8 {
    var writer: std.Io.Writer.Allocating = .init(allocator);
    errdefer writer.deinit();
    var stringify: std.json.Stringify = .{
        .writer = &writer.writer,
        .options = .{},
    };
    try stringify.write(value);
    return writer.toOwnedSlice();
}

fn encodeBase64Alloc(allocator: std.mem.Allocator, bytes: []const u8) ![]u8 {
    const size = std.base64.standard.Encoder.calcSize(bytes.len);
    const out = try allocator.alloc(u8, size);
    _ = std.base64.standard.Encoder.encode(out, bytes);
    return out;
}

fn computeAcceptKeyAlloc(allocator: std.mem.Allocator, key: []const u8) ![]u8 {
    var sha_input: std.ArrayList(u8) = .empty;
    defer sha_input.deinit(allocator);
    try sha_input.appendSlice(allocator, key);
    try sha_input.appendSlice(allocator, WS_GUID);

    var digest: [std.crypto.hash.Sha1.digest_length]u8 = undefined;
    std.crypto.hash.Sha1.hash(sha_input.items, &digest, .{});
    return encodeBase64Alloc(allocator, &digest);
}

fn buildRequestTargetAlloc(allocator: std.mem.Allocator, uri: std.Uri) ![]u8 {
    const path = switch (uri.path) {
        .raw => |raw| if (raw.len == 0) "/" else raw,
        .percent_encoded => |encoded| if (encoded.len == 0) "/" else encoded,
    };

    var target = std.ArrayList(u8).empty;
    defer target.deinit(allocator);
    try target.appendSlice(allocator, path);

    if (uri.query) |query| {
        try target.append(allocator, '?');
        switch (query) {
            .raw => |raw| try target.appendSlice(allocator, raw),
            .percent_encoded => |encoded| try target.appendSlice(allocator, encoded),
        }
    }

    return target.toOwnedSlice(allocator);
}

fn readHttpLineAlloc(allocator: std.mem.Allocator, stream: std.net.Stream) ![]u8 {
    var line: std.ArrayList(u8) = .empty;
    defer line.deinit(allocator);

    while (true) {
        var byte: [1]u8 = undefined;
        const read = try stream.read(&byte);
        if (read == 0) return error.EndOfStream;

        if (byte[0] == '\n') break;
        if (line.items.len >= MAX_HTTP_LINE_BYTES) return error.HttpLineTooLong;
        if (byte[0] != '\r') {
            try line.append(allocator, byte[0]);
        }
    }

    return line.toOwnedSlice(allocator);
}

fn readExact(stream: std.net.Stream, buffer: []u8) !void {
    var index: usize = 0;
    while (index < buffer.len) {
        const amt = try stream.read(buffer[index..]);
        if (amt == 0) return error.EndOfStream;
        index += amt;
    }
}

fn writeClientFrame(
    allocator: std.mem.Allocator,
    stream: std.net.Stream,
    payload: []const u8,
    opcode: FrameOpcode,
) !void {
    var header: [14]u8 = undefined;
    var index: usize = 0;

    header[index] = @as(u8, 0x80) | @as(u8, @intCast(@intFromEnum(opcode)));
    index += 1;

    if (payload.len <= 125) {
        header[index] = 0x80 | @as(u8, @intCast(payload.len));
        index += 1;
    } else if (payload.len <= std.math.maxInt(u16)) {
        header[index] = 0x80 | 126;
        index += 1;
        var len16: [2]u8 = undefined;
        std.mem.writeInt(u16, &len16, @intCast(payload.len), .big);
        @memcpy(header[index .. index + len16.len], &len16);
        index += 2;
    } else {
        header[index] = 0x80 | 127;
        index += 1;
        var len64: [8]u8 = undefined;
        std.mem.writeInt(u64, &len64, payload.len, .big);
        @memcpy(header[index .. index + len64.len], &len64);
        index += 8;
    }

    var mask: [4]u8 = undefined;
    std.crypto.random.bytes(&mask);
    @memcpy(header[index .. index + 4], &mask);
    index += 4;

    const masked = try allocator.alloc(u8, payload.len);
    defer allocator.free(masked);
    for (payload, 0..) |byte, i| {
        masked[i] = byte ^ mask[i % mask.len];
    }

    try stream.writeAll(header[0..index]);
    try stream.writeAll(masked);
}

fn readServerFrameAlloc(allocator: std.mem.Allocator, stream: std.net.Stream) !Frame {
    var header: [2]u8 = undefined;
    try readExact(stream, &header);

    const opcode: FrameOpcode = @enumFromInt(header[0] & 0x0f);
    const masked = (header[1] & 0x80) != 0;
    const len_marker = header[1] & 0x7f;

    const payload_len: usize = switch (len_marker) {
        126 => blk: {
            var buf: [2]u8 = undefined;
            try readExact(stream, &buf);
            break :blk std.mem.readInt(u16, &buf, .big);
        },
        127 => blk: {
            var buf: [8]u8 = undefined;
            try readExact(stream, &buf);
            const long = std.mem.readInt(u64, &buf, .big);
            break :blk std.math.cast(usize, long) orelse return error.WebSocketMessageTooLarge;
        },
        else => len_marker,
    };

    if (payload_len > MAX_WS_MESSAGE_BYTES) return error.WebSocketMessageTooLarge;

    var mask: [4]u8 = undefined;
    if (masked) {
        try readExact(stream, &mask);
    }

    const payload = try allocator.alloc(u8, payload_len);
    errdefer allocator.free(payload);
    try readExact(stream, payload);

    if (masked) {
        for (payload, 0..) |*byte, i| {
            byte.* ^= mask[i % mask.len];
        }
    }

    return .{
        .opcode = opcode,
        .payload = payload,
    };
}

fn parseMessageId(root: std.json.Value) ?u64 {
    const id_value = getObjectField(root, "id") orelse return null;
    return switch (id_value) {
        .integer => |value| if (value < 0) null else @as(u64, @intCast(value)),
        else => null,
    };
}

fn getObjectField(value: std.json.Value, field: []const u8) ?std.json.Value {
    if (value != .object) return null;
    return value.object.get(field);
}

fn stringValue(value: std.json.Value) ?[]const u8 {
    return switch (value) {
        .string => |text| text,
        else => null,
    };
}

fn getOptionalObjectString(value: std.json.Value, field: []const u8) ?[]const u8 {
    const field_value = getObjectField(value, field) orelse return null;
    return stringValue(field_value);
}

fn getOptionalObjectInteger(value: std.json.Value, field: []const u8) ?i64 {
    const field_value = getObjectField(value, field) orelse return null;
    return switch (field_value) {
        .integer => |number| number,
        else => null,
    };
}

fn appendNotificationDelta(
    root: std.json.Value,
    allocator: std.mem.Allocator,
    reply: *std.ArrayList(u8),
) !bool {
    const method = getOptionalObjectString(root, "method") orelse return false;
    if (!std.mem.eql(u8, method, "item/agentMessage/delta")) {
        return false;
    }

    const params = getObjectField(root, "params") orelse return true;

    if (findFirstStringByPath(params, &.{ "delta", "text" })) |text| {
        try reply.appendSlice(allocator, text);
        return true;
    }
    if (findFirstStringByPath(params, &.{"delta"})) |text| {
        try reply.appendSlice(allocator, text);
        return true;
    }
    if (findFirstStringByPath(params, &.{ "item", "text" })) |text| {
        try reply.appendSlice(allocator, text);
        return true;
    }
    if (findFirstStringByPath(params, &.{"text"})) |text| {
        try reply.appendSlice(allocator, text);
        return true;
    }

    return true;
}

fn extractNotificationDelta(root: std.json.Value) ?[]const u8 {
    const method = getOptionalObjectString(root, "method") orelse return null;
    if (!std.mem.eql(u8, method, "item/agentMessage/delta")) {
        return null;
    }

    const params = getObjectField(root, "params") orelse return null;

    return findFirstStringByPath(params, &.{ "delta", "text" }) orelse
        findFirstStringByPath(params, &.{"delta"}) orelse
        findFirstStringByPath(params, &.{ "item", "text" }) orelse
        findFirstStringByPath(params, &.{"text"});
}

fn isTurnCompleted(root: std.json.Value) bool {
    const method = getOptionalObjectString(root, "method") orelse return false;
    return std.mem.eql(u8, method, "turn/completed");
}

fn findFirstStringByPath(value: std.json.Value, fields: []const []const u8) ?[]const u8 {
    var current = value;
    for (fields) |field| {
        current = getObjectField(current, field) orelse return null;
    }
    return stringValue(current);
}

test "build request target preserves path and query" {
    const allocator = std.testing.allocator;
    const uri = try std.Uri.parse("ws://127.0.0.1:4500/rpc?client=native");
    const target = try buildRequestTargetAlloc(allocator, uri);
    defer allocator.free(target);

    try std.testing.expectEqualStrings("/rpc?client=native", target);
}

test "compute accept key matches websocket example" {
    const allocator = std.testing.allocator;
    const accept = try computeAcceptKeyAlloc(allocator, "dGhlIHNhbXBsZSBub25jZQ==");
    defer allocator.free(accept);

    try std.testing.expectEqualStrings("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", accept);
}
