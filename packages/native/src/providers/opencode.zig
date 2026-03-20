//! OpenCode provider harness backed by the local HTTP server.

const std = @import("std");
const provider_types = @import("../provider_types.zig");

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
            .thread_id = try allocator.dupe(u8, "todo-opencode-thread"),
            .reply_text = try allocator.dupe(u8, "TODO: wire OpenCode HTTP session/message transport."),
        };
    }
};
