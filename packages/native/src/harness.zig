//! Shared AI harness interface for native provider integrations.

const std = @import("std");
const opencode = @import("providers/opencode.zig");
const codex = @import("providers/codex.zig");

pub const Provider = enum(u8) {
    opencode,
    codex,
};

pub const HarnessKind = enum(u8) {
    local_cli,
    remote_session,
};

pub const AuthState = enum(u8) {
    unknown,
    signed_out,
    signed_in,
    pending,
};

pub const MessageRole = enum(u8) {
    system,
    user,
    assistant,
};

pub const ChatMessage = struct {
    role: MessageRole,
    author: []const u8,
    body: []const u8,
};

pub const ChatThreadSummary = struct {
    id: []const u8,
    title: []const u8,
};

pub const SendPromptRequest = struct {
    thread_id: ?[]const u8 = null,
    prompt: []const u8,
    cwd: ?[]const u8 = null,
};

pub const SendPromptResult = struct {
    thread_id: []const u8,
    reply_text: []const u8,
};

pub const ProviderConfig = union(Provider) {
    opencode: opencode.Config,
    codex: codex.Config,
};

pub const ProviderClient = union(Provider) {
    opencode: opencode.Client,
    codex: codex.Client,

    pub fn deinit(self: *ProviderClient) void {
        switch (self.*) {
            .opencode => |*client| client.deinit(),
            .codex => |*client| client.deinit(),
        }
    }

    pub fn authState(self: *ProviderClient) !AuthState {
        return switch (self.*) {
            .opencode => |*client| client.authState(),
            .codex => |*client| client.authState(),
        };
    }

    pub fn listThreads(self: *ProviderClient, allocator: std.mem.Allocator) ![]ChatThreadSummary {
        return switch (self.*) {
            .opencode => |*client| client.listThreads(allocator),
            .codex => |*client| client.listThreads(allocator),
        };
    }

    pub fn sendPrompt(self: *ProviderClient, allocator: std.mem.Allocator, request: SendPromptRequest) !SendPromptResult {
        return switch (self.*) {
            .opencode => |*client| client.sendPrompt(allocator, request),
            .codex => |*client| client.sendPrompt(allocator, request),
        };
    }
};

pub fn connect(
    allocator: std.mem.Allocator,
    provider: ProviderConfig,
) !ProviderClient {
    return switch (provider) {
        .opencode => |config| .{ .opencode = try opencode.Client.init(allocator, config) },
        .codex => |config| .{ .codex = try codex.Client.init(allocator, config) },
    };
}
