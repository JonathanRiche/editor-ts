//! Codex provider harness backed by `codex app-server`.

const std = @import("std");
const harness = @import("../harness.zig");

pub const Transport = enum(u8) {
    websocket,
    stdio_jsonl,
};

pub const Config = struct {
    allocator: std.mem.Allocator,
    executable: []const u8 = "codex",
    cwd: ?[]const u8 = null,
    transport: Transport = .websocket,
    websocket_url: ?[]const u8 = "ws://127.0.0.1:4500",
    launch_on_connect: bool = true,
};

pub const Client = struct {
    allocator: std.mem.Allocator,
    config: Config,

    pub fn init(allocator: std.mem.Allocator, config: Config) !Client {
        _ = allocator;
        return .{
            .allocator = config.allocator,
            .config = config,
        };
    }

    pub fn deinit(self: *Client) void {
        _ = self;
    }

    pub fn authState(self: *Client) !harness.AuthState {
        _ = self;
        return .unknown;
    }

    pub fn listThreads(self: *Client, allocator: std.mem.Allocator) ![]harness.ChatThreadSummary {
        _ = self;
        return allocator.alloc(harness.ChatThreadSummary, 0);
    }

    pub fn sendPrompt(
        self: *Client,
        allocator: std.mem.Allocator,
        request: harness.SendPromptRequest,
    ) !harness.SendPromptResult {
        _ = self;
        _ = request;
        return .{
            .thread_id = try allocator.dupe(u8, "todo-codex-thread"),
            .reply_text = try allocator.dupe(u8, "TODO: wire Codex app-server JSON-RPC transport."),
        };
    }
};
