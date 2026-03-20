//! Codex provider harness backed by `codex app-server`.

const std = @import("std");
const provider_types = @import("../provider_types.zig");

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

    pub fn authState(self: *Client) !provider_types.AuthState {
        _ = self;
        return .unknown;
    }

    pub fn listThreads(self: *Client, allocator: std.mem.Allocator) ![]provider_types.ChatThreadSummary {
        _ = self;
        return allocator.alloc(provider_types.ChatThreadSummary, 0);
    }

    pub fn sendPrompt(
        self: *Client,
        allocator: std.mem.Allocator,
        request: provider_types.SendPromptRequest,
    ) !provider_types.SendPromptResult {
        _ = self;
        _ = request;
        return .{
            .thread_id = try allocator.dupe(u8, "todo-codex-thread"),
            .reply_text = try allocator.dupe(u8, "TODO: wire Codex app-server JSON-RPC transport."),
        };
    }
};
