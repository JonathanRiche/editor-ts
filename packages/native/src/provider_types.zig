//! Shared provider-neutral types for native AI harnesses.

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

pub const ReasoningEffort = enum(u8) {
    low,
    medium,
    high,
    xhigh,
};

pub const StreamEvent = struct {
    title: []const u8,
    body: []const u8,
};

pub const SendPromptRequest = struct {
    thread_id: ?[]const u8 = null,
    prompt: []const u8,
    cwd: ?[]const u8 = null,
    model: ?[]const u8 = null,
    reasoning_effort: ?ReasoningEffort = null,
    stream_context: ?*anyopaque = null,
    on_stream_delta: ?*const fn (?*anyopaque, []const u8) void = null,
    on_stream_event: ?*const fn (?*anyopaque, StreamEvent) void = null,
};

pub const SendPromptResult = struct {
    thread_id: []const u8,
    reply_text: []const u8,
};
