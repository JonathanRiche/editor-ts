//! OpenCode provider harness backed by the local HTTP server.

const std = @import("std");
const harness = @import("../harness.zig");

pub const Config = struct {
    allocator: std.mem.Allocator,
    base_url: []const u8 = "http://127.0.0.1:4096",
    working_directory: ?[]const u8 = null,
    username: ?[]const u8 = null,
    password: ?[]const u8 = null,
    launch_if_missing: bool = false,
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
            .thread_id = try allocator.dupe(u8, "todo-opencode-thread"),
            .reply_text = try allocator.dupe(u8, "TODO: wire OpenCode HTTP session/message transport."),
        };
    }
};
