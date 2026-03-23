//! Minimal native shell prototype for the desktop chat workflow.

const std = @import("std");
const app_config = @import("config.zig");
const keybinds = @import("keybinds.zig");
const zgui = @import("zgui");
const sdl = @import("zsdl3");
const ai_harness = @import("harness.zig");
const stb_image = @import("stb_image.zig");

const log = std.log.scoped(.native_shell);
const ORG_NAME: [:0]const u8 = "Verde";
const APP_NAME: [:0]const u8 = "Native";
const STATE_FILE_NAME = "state.json";
const GEIST_SANS_BYTES = @embedFile("assets/fonts/Geist-Regular.ttf");
const DEFAULT_FONT_SIZE: f32 = 18.0;
const DEFAULT_WINDOW_WIDTH: c_int = 1360;
const DEFAULT_WINDOW_HEIGHT: c_int = 860;
const MIN_WINDOW_WIDTH: c_int = 960;
const MIN_WINDOW_HEIGHT: c_int = 680;
const MAX_WINDOW_WIDTH: c_int = 1520;
const MAX_WINDOW_HEIGHT: c_int = 980;

//for hex in fornt of each 2 chars add 0x
const COLOR_GREEN = rgb(0x50, 0xc8, 0x78);
const COLOR_YELLOW = rgb(0xfb, 0xbf, 0x24);
const COLOR_BLACK = rgba(22, 22, 26, 255);
const COLOR_WHITE = rgba(240, 240, 245, 255);
const COLOR_PANEL = rgba(30, 31, 35, 255);
const COLOR_PANEL_ALT = rgba(40, 41, 46, 255);
const COLOR_PANEL_MUTED = rgba(56, 57, 62, 255);
const COLOR_TEXT_MUTED = rgba(185, 187, 195, 255);
const COLOR_TEXT_SUBTLE = rgba(120, 122, 135, 255);
const COLOR_DIFF_ADD = rgba(52, 224, 148, 255);
const COLOR_DIFF_REMOVE = rgba(255, 100, 100, 255);
const COLOR_ACCENT_DIM = rgba(124, 221, 94, 48);
const TRANSCRIPT_BUBBLE_PADDING_X: f32 = 18.0;
const TRANSCRIPT_BUBBLE_PADDING_Y: f32 = 14.0;
const TRANSCRIPT_BUBBLE_ROUNDING: f32 = 14.0;
const PERSISTED_DIFF_MARKER = "EDITORTS_DIFF_V1\n";
const IMAGE_MODAL_ID: [:0]const u8 = "AttachmentPreviewModal";
const PROJECT_RENAME_MODAL_ID: [:0]const u8 = "ProjectRenameModal";
const RESPONSIVE_BASE_FONT_SIZE: f32 = 18.0;

var heading_font: ?zgui.Font = null;
var heading_font_size: f32 = DEFAULT_FONT_SIZE * 1.28;

const GL_TEXTURE_2D = 0x0DE1;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_LINEAR = 0x2601;
const GL_TEXTURE_MIN_FILTER = 0x2801;
const GL_TEXTURE_MAG_FILTER = 0x2800;
const GL_TEXTURE_WRAP_S = 0x2802;
const GL_TEXTURE_WRAP_T = 0x2803;
const GL_CLAMP_TO_EDGE = 0x812F;
const GL_UNPACK_ALIGNMENT = 0x0CF5;

extern fn glGenTextures(n: c_int, textures: [*]c_uint) void;
extern fn glBindTexture(target: c_uint, texture: c_uint) void;
extern fn glTexParameteri(target: c_uint, pname: c_uint, param: c_int) void;
extern fn glTexImage2D(target: c_uint, level: c_int, internalformat: c_int, width: c_int, height: c_int, border: c_int, format: c_uint, type_: c_uint, pixels: ?*const anyopaque) void;
extern fn glDeleteTextures(n: c_int, textures: [*]const c_uint) void;
extern fn glPixelStorei(pname: c_uint, param: c_int) void;
extern fn SDL_GetPrimaryDisplay() sdl.DisplayId;
extern fn SDL_GetDisplayUsableBounds(display_id: sdl.DisplayId, rect: *SdlRect) bool;
extern fn SDL_GetWindowSizeInPixels(window: *sdl.Window, w: ?*c_int, h: ?*c_int) bool;
extern fn SDL_GetWindowDisplayScale(window: *sdl.Window) f32;
extern fn SDL_SetWindowPosition(window: *sdl.Window, x: c_int, y: c_int) bool;

const SdlRect = extern struct {
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
};

const ChatRole = enum(u8) {
    user,
    assistant,
    system,
};

const Provider = enum(u8) {
    opencode,
    codex,
};

const Harness = enum(u8) {
    local_cli,
    remote_session,
};

const ReasoningEffort = ai_harness.ReasoningEffort;

const FastMode = enum(u8) {
    off,
    on,
};

const AccessMode = enum(u8) {
    full_access,
    supervised,
};

const ModelOption = struct {
    label: [:0]const u8,
    value: ?[:0]const u8 = null,
};

const ReasoningOption = struct {
    label: [:0]const u8,
    value: ?ReasoningEffort = null,
};

const FastModeOption = struct {
    label: [:0]const u8,
    value: FastMode,
};

const AccessModeOption = struct {
    label: [:0]const u8,
    value: AccessMode,
};

const OPENCODE_MODEL_OPTIONS = [_]ModelOption{
    .{ .label = "Default", .value = null },
    .{ .label = "GPT-5.4", .value = "opencode/gpt-5.4" },
    .{ .label = "Claude Opus 4.6", .value = "opencode/claude-opus-4-6" },
    .{ .label = "Claude Sonnet 4.5", .value = "opencode/claude-sonnet-4-5" },
    .{ .label = "Gemini 3.1 Pro", .value = "opencode/gemini-3.1-pro" },
};

const CODEX_MODEL_OPTIONS = [_]ModelOption{
    .{ .label = "Default", .value = null },
    .{ .label = "GPT-5.4", .value = "gpt-5.4" },
    .{ .label = "GPT-5.4 Mini", .value = "gpt-5.4-mini" },
    .{ .label = "GPT-5.3 Codex", .value = "gpt-5.3-codex" },
    .{ .label = "GPT-5.3 Codex Spark", .value = "gpt-5.3-codex-spark" },
    .{ .label = "GPT-5.2 Codex", .value = "gpt-5.2-codex" },
    .{ .label = "GPT-5.2", .value = "gpt-5.2" },
};

const CODEX_REASONING_OPTIONS = [_]ReasoningOption{
    .{ .label = "Default", .value = null },
    .{ .label = "Low", .value = .low },
    .{ .label = "Medium", .value = .medium },
    .{ .label = "High", .value = .high },
    .{ .label = "Extra High", .value = .xhigh },
};

const CODEX_FAST_MODE_OPTIONS = [_]FastModeOption{
    .{ .label = "Off", .value = .off },
    .{ .label = "On", .value = .on },
};

const CODEX_ACCESS_MODE_OPTIONS = [_]AccessModeOption{
    .{ .label = "Full access", .value = .full_access },
    .{ .label = "Supervised", .value = .supervised },
};

const DEFAULT_CODEX_MODEL: [:0]const u8 = "gpt-5.4";
const SIDEBAR_VISIBLE_THREAD_LIMIT: usize = 6;
const CLIPBOARD_IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;

const ChatImageAttachment = struct {
    path: [:0]const u8,
    file_name: [:0]const u8,
    mime: [:0]const u8,
    byte_size: usize,

    fn init(allocator: std.mem.Allocator, path: []const u8, mime: []const u8, byte_size: usize) !ChatImageAttachment {
        return .{
            .path = try allocator.dupeZ(u8, path),
            .file_name = try allocator.dupeZ(u8, std.fs.path.basename(path)),
            .mime = try allocator.dupeZ(u8, mime),
            .byte_size = byte_size,
        };
    }

    fn deinit(self: ChatImageAttachment, allocator: std.mem.Allocator) void {
        allocator.free(self.path);
        allocator.free(self.file_name);
        allocator.free(self.mime);
    }
};

const ChatMessage = struct {
    role: ChatRole,
    author: [:0]const u8,
    body: [:0]const u8,
    image: ?ChatImageAttachment = null,
};

const ChangedFileEntry = struct {
    path: []const u8,
    additions: i64,
    deletions: i64,
    patch: ?[]const u8 = null,
};

const PendingDiffFile = struct {
    path: []u8,
    additions: i64,
    deletions: i64,
    patch: ?[]u8 = null,
    expanded: bool = false,
};

const ChatThread = struct {
    title: [:0]const u8,
    committed: bool = false,
    last_activity_at: i64 = 0,
    provider_thread_id: ?[:0]const u8 = null,
    model_ref: ?[:0]const u8 = null,
    reasoning_effort: ?ReasoningEffort = null,
    fast_mode: FastMode = .off,
    access_mode: AccessMode = .full_access,
    provider: Provider = .opencode,
    harness: Harness = .local_cli,
    messages: std.ArrayList(ChatMessage),
    draft_image: ?ChatImageAttachment = null,
    draft_storage: [AppState.DRAFT_CAPACITY:0]u8,

    fn init(allocator: std.mem.Allocator, title: []const u8) !ChatThread {
        return .{
            .title = try allocator.dupeZ(u8, title),
            .committed = false,
            .last_activity_at = 0,
            .model_ref = try allocator.dupeZ(u8, DEFAULT_CODEX_MODEL),
            .reasoning_effort = .high,
            .fast_mode = .off,
            .access_mode = .full_access,
            .provider = .codex,
            .harness = .local_cli,
            .messages = .empty,
            .draft_image = null,
            .draft_storage = std.mem.zeroes([AppState.DRAFT_CAPACITY:0]u8),
        };
    }

    fn currentDraft(self: *const ChatThread) []const u8 {
        const slice = self.draft_storage[0..];
        return std.mem.sliceTo(slice, 0);
    }

    fn draftBuffer(self: *ChatThread) [:0]u8 {
        return self.draft_storage[0 .. self.draft_storage.len - 1 :0];
    }

    fn setDraft(self: *ChatThread, value: []const u8) void {
        @memset(&self.draft_storage, 0);
        const len = @min(value.len, AppState.DRAFT_CAPACITY - 1);
        @memcpy(self.draft_storage[0..len], value[0..len]);
    }

    fn clearDraft(self: *ChatThread) void {
        self.draft_storage[0] = 0;
    }

    fn setDraftImage(self: *ChatThread, allocator: std.mem.Allocator, path: []const u8, mime: []const u8, byte_size: usize) !void {
        self.clearDraftImage(allocator);
        self.draft_image = try ChatImageAttachment.init(allocator, path, mime, byte_size);
    }

    fn clearDraftImage(self: *ChatThread, allocator: std.mem.Allocator) void {
        if (self.draft_image) |*image| {
            image.deinit(allocator);
            self.draft_image = null;
        }
    }

    fn commitFromPrompt(self: *ChatThread, allocator: std.mem.Allocator, prompt: []const u8) !void {
        self.committed = true;
        self.last_activity_at = std.time.timestamp();
        const next_title = try makeThreadTitle(allocator, prompt);
        allocator.free(self.title);
        self.title = next_title;
    }

    fn touch(self: *ChatThread) void {
        self.last_activity_at = std.time.timestamp();
    }

    fn deinit(self: *ChatThread, allocator: std.mem.Allocator) void {
        allocator.free(self.title);
        if (self.provider_thread_id) |thread_id| allocator.free(thread_id);
        if (self.model_ref) |model_ref| allocator.free(model_ref);
        for (self.messages.items) |message| {
            allocator.free(message.author);
            allocator.free(message.body);
            if (message.image) |*image| image.deinit(allocator);
        }
        self.messages.deinit(allocator);
        self.clearDraftImage(allocator);
    }
};

const Project = struct {
    id: [:0]const u8,
    label: [:0]const u8,
    path: [:0]const u8,
    unread_count: u8 = 0,
    collapsed: bool = false,
    thread_list_expanded: bool = false,
    threads: std.ArrayList(ChatThread),
    selected_thread_index: usize = 0,

    fn init(allocator: std.mem.Allocator, id: []const u8, label: []const u8, path: []const u8, unread_count: u8) !Project {
        var project: Project = .{
            .id = try allocator.dupeZ(u8, id),
            .label = try allocator.dupeZ(u8, label),
            .path = try allocator.dupeZ(u8, path),
            .unread_count = unread_count,
            .collapsed = false,
            .thread_list_expanded = false,
            .threads = .empty,
            .selected_thread_index = 0,
        };
        try project.addThread(allocator);
        return project;
    }

    fn currentThread(self: *const Project) *const ChatThread {
        return &self.threads.items[self.selected_thread_index];
    }

    fn currentThreadMutable(self: *Project) *ChatThread {
        return &self.threads.items[self.selected_thread_index];
    }

    fn currentDraft(self: *const Project) []const u8 {
        return self.currentThread().currentDraft();
    }

    fn draftBuffer(self: *Project) [:0]u8 {
        return self.currentThreadMutable().draftBuffer();
    }

    fn setDraft(self: *Project, value: []const u8) void {
        self.currentThreadMutable().setDraft(value);
    }

    fn clearDraft(self: *Project) void {
        self.currentThreadMutable().clearDraft();
    }

    fn addThread(self: *Project, allocator: std.mem.Allocator) !void {
        try self.threads.append(allocator, try ChatThread.init(allocator, "New thread"));
        self.selected_thread_index = self.threads.items.len - 1;
    }

    fn normalize(self: *Project, allocator: std.mem.Allocator) !void {
        if (self.threads.items.len == 0) {
            try self.addThread(allocator);
        }
        if (self.selected_thread_index >= self.threads.items.len) {
            self.selected_thread_index = self.threads.items.len - 1;
        }
        for (self.threads.items) |*thread| {
            sanitizeProvider(&thread.provider);
            sanitizeHarness(&thread.harness);
            for (thread.messages.items) |*message| {
                sanitizeChatRole(&message.role);
            }
        }
    }

    fn committedThreadCount(self: *const Project) usize {
        var count: usize = 0;
        for (self.threads.items) |thread| {
            if (thread.committed) count += 1;
        }
        return count;
    }

    fn deinit(self: *Project, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        allocator.free(self.label);
        allocator.free(self.path);
        for (self.threads.items) |*thread| {
            thread.deinit(allocator);
        }
        self.threads.deinit(allocator);
    }
};

const PersistedProject = struct {
    id: ?[]const u8 = null,
    label: []const u8,
    path: []const u8,
    unread_count: u8 = 0,
    collapsed: ?bool = null,
    thread_list_expanded: ?bool = null,
    selected_thread_index: usize = 0,
    threads: ?[]const PersistedThread = null,
    provider: Provider = .opencode,
    harness: Harness = .local_cli,
    draft: []const u8 = "",
    messages: []const PersistedMessage = &.{},
};

const PersistedThread = struct {
    title: []const u8,
    committed: bool = true,
    last_activity_at: ?i64 = null,
    provider_thread_id: ?[]const u8 = null,
    model_ref: ?[]const u8 = null,
    reasoning_effort: ?ReasoningEffort = null,
    fast_mode: ?FastMode = null,
    access_mode: ?AccessMode = null,
    provider: Provider = .opencode,
    harness: Harness = .local_cli,
    draft: []const u8 = "",
    draft_image: ?PersistedImageAttachment = null,
    messages: []const PersistedMessage = &.{},
};

const PersistedMessage = struct {
    role: ChatRole,
    author: []const u8,
    body: []const u8,
    image: ?PersistedImageAttachment = null,
};

const PersistedImageAttachment = struct {
    path: []const u8,
    mime: []const u8,
    byte_size: usize = 0,
};

const PersistedState = struct {
    selected_project_index: usize = 0,
    projects: []const PersistedProject = &.{},
    provider: ?Provider = null,
    harness: ?Harness = null,
    draft: ?[]const u8 = null,
    messages: ?[]const PersistedMessage = null,
};

const SaveProject = struct {
    id: []const u8,
    label: []const u8,
    path: []const u8,
    unread_count: u8,
    collapsed: bool,
    thread_list_expanded: bool,
    selected_thread_index: usize,
    threads: []const SaveThread,
};

const SaveThread = struct {
    title: []const u8,
    committed: bool,
    last_activity_at: i64,
    provider_thread_id: ?[]const u8,
    model_ref: ?[]const u8,
    reasoning_effort: ?ReasoningEffort,
    fast_mode: FastMode,
    access_mode: AccessMode,
    provider: Provider,
    harness: Harness,
    draft: []const u8,
    draft_image: ?SaveImageAttachment,
    messages: []const SaveMessage,
};

const SaveMessage = struct {
    role: ChatRole,
    author: []const u8,
    body: []const u8,
    image: ?SaveImageAttachment,
};

const SaveImageAttachment = struct {
    path: []const u8,
    mime: []const u8,
    byte_size: usize,
};

const SaveState = struct {
    selected_project_index: usize,
    projects: []const SaveProject,
};

const CachedImageTexture = struct {
    texture_id: c_uint,
    width: i32,
    height: i32,
    valid: bool,

    fn deinit(self: CachedImageTexture) void {
        if (!self.valid or self.texture_id == 0) return;
        var textures = [_]c_uint{self.texture_id};
        glDeleteTextures(1, &textures);
    }
};

const PickerStatus = enum {
    idle,
    pending,
    selected,
    cancelled,
    unavailable,
    failed,
};

const PickerState = struct {
    mutex: std.Thread.Mutex = .{},
    status: PickerStatus = .idle,
    selected_path: ?[]u8 = null,
    worker: ?std.Thread = null,
};

const SendStatus = enum {
    idle,
    pending,
    completed,
    failed,
};

const SendResultPayload = struct {
    project_index: usize,
    thread_index: usize,
    provider_thread_id: []const u8,
    reply_text: []const u8,
};

const PendingTimelineEvent = struct {
    role: ChatRole,
    author: []u8,
    body: []u8,
};

const PendingApproval = struct {
    call_id: []u8,
    title: []u8,
    body: []u8,
};

const SendState = struct {
    mutex: std.Thread.Mutex = .{},
    condition: std.Thread.Condition = .{},
    status: SendStatus = .idle,
    result: ?SendResultPayload = null,
    error_message: ?[]u8 = null,
    provider: ?Provider = null,
    project_index: ?usize = null,
    thread_index: ?usize = null,
    partial_text: std.ArrayListUnmanaged(u8) = .empty,
    pending_events: std.ArrayListUnmanaged(PendingTimelineEvent) = .empty,
    pending_diff_files: std.ArrayListUnmanaged(PendingDiffFile) = .empty,
    pending_approval: ?PendingApproval = null,
    approval_decision: ?ai_harness.ApprovalDecision = null,
    worker: ?std.Thread = null,
};

const SendWorkerRequest = struct {
    send_state_ptr: *SendState,
    project_index: usize,
    thread_index: usize,
    provider: Provider,
    harness: Harness,
    project_path: []u8,
    prompt: []u8,
    image_path: ?[]u8,
    provider_thread_id: ?[]u8,
    model_ref: ?[]u8,
    reasoning_effort: ?ReasoningEffort,
    fast_mode: FastMode,
    access_mode: AccessMode,
};

const Storage = struct {
    allocator: std.mem.Allocator,
    pref_path: []const u8,

    fn init(allocator: std.mem.Allocator) !Storage {
        const pref_path = sdl.getPrefPath(ORG_NAME, APP_NAME) orelse return error.SdlError;
        try std.fs.cwd().makePath(pref_path);
        return .{
            .allocator = allocator,
            .pref_path = try allocator.dupe(u8, pref_path),
        };
    }

    fn deinit(self: *Storage) void {
        self.allocator.free(self.pref_path);
    }

    fn load(self: *const Storage, allocator: std.mem.Allocator) !?std.json.Parsed(PersistedState) {
        var dir = try std.fs.openDirAbsolute(self.pref_path, .{});
        defer dir.close();

        const bytes = dir.readFileAlloc(allocator, STATE_FILE_NAME, 1024 * 1024) catch |err| switch (err) {
            error.FileNotFound => return null,
            else => return err,
        };
        defer allocator.free(bytes);

        return try std.json.parseFromSlice(PersistedState, allocator, bytes, .{
            .allocate = .alloc_always,
        });
    }

    fn save(self: *const Storage, state: *const AppState) !void {
        var buffer: std.Io.Writer.Allocating = .init(self.allocator);
        defer buffer.deinit();

        var stringify: std.json.Stringify = .{
            .writer = &buffer.writer,
            .options = .{ .whitespace = .indent_2 },
        };
        try stringify.beginObject();
        try stringify.objectField("selected_project_index");
        try stringify.write(state.selected_project_index);
        try stringify.objectField("projects");
        try stringify.beginArray();
        for (state.projects.items) |project| {
            const selected_save_index = selectedCommittedThreadIndex(&project);
            try stringify.beginObject();
            try stringify.objectField("id");
            try stringify.write(project.id);
            try stringify.objectField("label");
            try stringify.write(project.label);
            try stringify.objectField("path");
            try stringify.write(project.path);
            try stringify.objectField("unread_count");
            try stringify.write(project.unread_count);
            try stringify.objectField("collapsed");
            try stringify.write(project.collapsed);
            try stringify.objectField("thread_list_expanded");
            try stringify.write(project.thread_list_expanded);
            try stringify.objectField("selected_thread_index");
            try stringify.write(selected_save_index);
            try stringify.objectField("threads");
            try stringify.beginArray();
            for (project.threads.items) |thread| {
                if (!thread.committed) continue;
                try stringify.beginObject();
                try stringify.objectField("title");
                try stringify.write(thread.title);
                try stringify.objectField("committed");
                try stringify.write(thread.committed);
                try stringify.objectField("last_activity_at");
                try stringify.write(thread.last_activity_at);
                try stringify.objectField("provider_thread_id");
                try stringify.write(thread.provider_thread_id);
                try stringify.objectField("model_ref");
                try stringify.write(thread.model_ref);
                try stringify.objectField("reasoning_effort");
                try stringify.write(thread.reasoning_effort);
                try stringify.objectField("fast_mode");
                try stringify.write(thread.fast_mode);
                try stringify.objectField("access_mode");
                try stringify.write(thread.access_mode);
                try stringify.objectField("provider");
                try stringify.write(thread.provider);
                try stringify.objectField("harness");
                try stringify.write(thread.harness);
                try stringify.objectField("draft");
                try stringify.write(thread.currentDraft());
                try stringify.objectField("draft_image");
                if (thread.draft_image) |image| {
                    try stringify.beginObject();
                    try stringify.objectField("path");
                    try stringify.write(image.path);
                    try stringify.objectField("mime");
                    try stringify.write(image.mime);
                    try stringify.objectField("byte_size");
                    try stringify.write(image.byte_size);
                    try stringify.endObject();
                } else {
                    try stringify.write(null);
                }
                try stringify.objectField("messages");
                try stringify.beginArray();
                for (thread.messages.items) |message| {
                    try stringify.beginObject();
                    try stringify.objectField("role");
                    try stringify.write(message.role);
                    try stringify.objectField("author");
                    try stringify.write(message.author);
                    try stringify.objectField("body");
                    try stringify.write(message.body);
                    try stringify.objectField("image");
                    if (message.image) |image| {
                        try stringify.beginObject();
                        try stringify.objectField("path");
                        try stringify.write(image.path);
                        try stringify.objectField("mime");
                        try stringify.write(image.mime);
                        try stringify.objectField("byte_size");
                        try stringify.write(image.byte_size);
                        try stringify.endObject();
                    } else {
                        try stringify.write(null);
                    }
                    try stringify.endObject();
                }
                try stringify.endArray();
                try stringify.endObject();
            }
            try stringify.endArray();
            try stringify.endObject();
        }
        try stringify.endArray();
        try stringify.endObject();

        const json_bytes = try buffer.toOwnedSlice();
        defer self.allocator.free(json_bytes);

        var dir = try std.fs.openDirAbsolute(self.pref_path, .{});
        defer dir.close();
        try dir.writeFile(.{
            .sub_path = STATE_FILE_NAME,
            .data = json_bytes,
            .flags = .{},
        });
    }
};

const AppState = struct {
    const DRAFT_CAPACITY = 1024;

    allocator: std.mem.Allocator,
    storage: *const Storage,
    projects: std.ArrayList(Project),
    selected_project_index: usize,
    next_project_number: usize,
    import_path_storage: [DRAFT_CAPACITY:0]u8,
    rename_storage: [256:0]u8,
    sidebar_notice_storage: [256:0]u8,
    composer_focused: bool,
    image_texture_cache: std.StringHashMap(CachedImageTexture),
    modal_image_path: ?[:0]const u8,
    rename_project_index: ?usize,
    show_project_creator: bool,
    picker_state: PickerState,
    send_state: SendState,
    scroll_transcript_to_bottom: bool,
    dirty: bool,

    fn init(allocator: std.mem.Allocator, storage: *const Storage) !AppState {
        var state: AppState = .{
            .allocator = allocator,
            .storage = storage,
            .projects = .empty,
            .selected_project_index = 0,
            .next_project_number = 4,
            .import_path_storage = std.mem.zeroes([DRAFT_CAPACITY:0]u8),
            .rename_storage = std.mem.zeroes([256:0]u8),
            .sidebar_notice_storage = std.mem.zeroes([256:0]u8),
            .composer_focused = false,
            .image_texture_cache = std.StringHashMap(CachedImageTexture).init(allocator),
            .modal_image_path = null,
            .rename_project_index = null,
            .show_project_creator = false,
            .picker_state = .{},
            .send_state = .{},
            .scroll_transcript_to_bottom = true,
            .dirty = false,
        };

        if (try storage.load(allocator)) |persisted| {
            defer persisted.deinit();
            try state.applyPersisted(persisted.value);
        } else {
            try state.seedDefaultState();
        }
        return state;
    }

    fn addProject(self: *AppState, label: []const u8, path: []const u8, unread_count: u8) !void {
        const id = try self.deriveProjectId(path);
        defer self.allocator.free(id);
        try self.projects.append(self.allocator, try Project.init(self.allocator, id, label, path, unread_count));
        self.markDirty();
    }

    fn appendMessage(self: *AppState, role: ChatRole, author: []const u8, body: []const u8, image: ?*const ChatImageAttachment) !void {
        const thread = self.currentThreadMutable();
        if (thread.messages.items.len == 24) {
            const removed = thread.messages.orderedRemove(0);
            self.allocator.free(removed.author);
            self.allocator.free(removed.body);
            if (removed.image) |*removed_image| removed_image.deinit(self.allocator);
        }

        try thread.messages.append(self.allocator, .{
            .role = role,
            .author = try self.dupeZ(author),
            .body = try self.dupeZ(body),
            .image = if (image) |attachment|
                try ChatImageAttachment.init(self.allocator, attachment.path, attachment.mime, attachment.byte_size)
            else
                null,
        });
        thread.touch();
        self.markDirty();
    }

    fn importProjectFromInput(self: *AppState) !void {
        const trimmed = std.mem.trim(u8, self.importPath(), &std.ascii.whitespace);
        if (trimmed.len == 0) {
            self.setSidebarNotice("Enter a project directory path first.");
            return;
        }

        const resolved = try self.resolveProjectPath(trimmed);
        defer self.allocator.free(resolved);

        if (self.findProjectIndexByPath(resolved) != null) {
            self.setSidebarNotice("That directory is already in the project rail.");
            return;
        }

        const label = projectLabelFromPath(resolved);
        try self.addProject(label, resolved, 0);
        self.selected_project_index = self.projects.items.len - 1;
        self.clearImportPath();
        self.syncRenameBuffer();
        self.setSidebarNotice("Project imported.");
        self.show_project_creator = false;
        self.markDirty();
    }

    fn browseForProjectDirectory(self: *AppState) void {
        const target_path = self.defaultExplorerPath() catch |err| {
            self.setSidebarNotice(@errorName(err));
            return;
        };
        const page_alloc = std.heap.page_allocator;
        const owned_target = page_alloc.dupe(u8, target_path) catch {
            self.allocator.free(target_path);
            self.setSidebarNotice("Failed to start folder picker.");
            return;
        };
        self.allocator.free(target_path);

        self.picker_state.mutex.lock();
        defer self.picker_state.mutex.unlock();

        if (self.picker_state.status == .pending) {
            page_alloc.free(owned_target);
            self.setSidebarNotice("Folder picker already open.");
            return;
        }

        self.picker_state.status = .pending;
        self.picker_state.selected_path = null;
        self.picker_state.worker = std.Thread.spawn(.{}, pickerWorker, .{ &self.picker_state, owned_target }) catch {
            page_alloc.free(owned_target);
            self.picker_state.status = .failed;
            self.setSidebarNotice("Failed to start folder picker.");
            return;
        };
        self.setSidebarNotice("Waiting for folder selection...");
    }

    fn renameSelectedProject(self: *AppState) void {
        if (self.projects.items.len == 0) return;
        const trimmed = std.mem.trim(u8, self.renameInput(), &std.ascii.whitespace);
        if (trimmed.len == 0) {
            self.setSidebarNotice("Project name cannot be empty.");
            return;
        }

        const project = self.currentProjectMutable();
        self.allocator.free(project.label);
        project.label = self.allocator.dupeZ(u8, trimmed) catch {
            self.setSidebarNotice("Rename failed.");
            return;
        };
        self.setSidebarNotice("Project renamed.");
        self.markDirty();
    }

    fn beginProjectRename(self: *AppState, index: usize) void {
        if (index >= self.projects.items.len) return;
        self.selected_project_index = index;
        self.rename_project_index = index;
        self.syncRenameBuffer();
        self.setSidebarNotice("");
    }

    fn finishProjectRename(self: *AppState) void {
        if (self.rename_project_index) |index| {
            if (index < self.projects.items.len) {
                self.selected_project_index = index;
                self.renameSelectedProject();
            }
        }
        self.rename_project_index = null;
    }

    fn cancelProjectRename(self: *AppState) void {
        self.rename_project_index = null;
        self.syncRenameBuffer();
    }

    fn removeProjectAtIndex(self: *AppState, index: usize) void {
        if (index >= self.projects.items.len) return;
        self.selected_project_index = index;
        self.removeSelectedProject();
        self.rename_project_index = null;
    }

    fn removeSelectedProject(self: *AppState) void {
        if (self.projects.items.len == 0) return;
        var removed = self.projects.orderedRemove(self.selected_project_index);
        removed.deinit(self.allocator);

        if (self.projects.items.len == 0) {
            self.selected_project_index = 0;
        } else if (self.selected_project_index >= self.projects.items.len) {
            self.selected_project_index = self.projects.items.len - 1;
        }

        self.syncRenameBuffer();
        self.setSidebarNotice("Project removed from recents.");
        self.markDirty();
    }

    fn createThreadForProject(self: *AppState, index: usize) void {
        if (index >= self.projects.items.len) return;
        var project = &self.projects.items[index];
        project.addThread(self.allocator) catch {
            self.setSidebarNotice("Failed to create a new thread.");
            return;
        };
        self.selected_project_index = index;
        self.syncRenameBuffer();
        self.setSidebarNotice("New thread ready.");
        self.markDirty();
    }

    fn sendDraft(self: *AppState) !void {
        const draft = self.currentDraft();
        const draft_image = self.currentThread().draft_image;
        if (draft.len == 0 and draft_image == null) return;

        self.send_state.mutex.lock();
        const send_pending = self.send_state.status == .pending;
        self.send_state.mutex.unlock();
        if (send_pending) {
            self.setSidebarNotice("A provider request is already running.");
            return;
        }

        if (draft_image != null and self.currentThread().provider != .codex) {
            self.setSidebarNotice("Image attachments are available for Codex threads only right now.");
            return;
        }

        const trimmed_title = std.mem.trim(u8, draft, &std.ascii.whitespace);
        const thread = self.currentThreadMutable();
        if (!thread.committed) {
            try thread.commitFromPrompt(self.allocator, if (trimmed_title.len > 0) trimmed_title else "Image");
        }
        var draft_image_copy = draft_image;
        try self.appendMessage(.user, "You", draft, if (draft_image_copy) |*image| image else null);
        try self.beginSendDraft(draft);
        self.clearDraft();
        thread.clearDraftImage(self.allocator);
        self.setSidebarNotice("Waiting for provider reply...");
    }

    fn sendPromptViaHarness(self: *AppState, prompt: []const u8) !ai_harness.SendPromptResult {
        const project = self.currentProject();
        const thread = self.currentThread();

        if (thread.harness != .local_cli) {
            return error.UnsupportedHarnessMode;
        }

        const provider_config = switch (thread.provider) {
            .opencode => ai_harness.ProviderConfig{
                .opencode = .{
                    .allocator = self.allocator,
                    .working_directory = project.path,
                    .launch_if_missing = true,
                },
            },
            .codex => ai_harness.ProviderConfig{
                .codex = .{
                    .cwd = project.path,
                    .launch_on_connect = true,
                },
            },
        };

        var client = try ai_harness.connect(self.allocator, provider_config);
        defer client.deinit();

        return client.sendPrompt(self.allocator, .{
            .thread_id = if (thread.provider_thread_id) |thread_id| thread_id else null,
            .prompt = prompt,
            .cwd = project.path,
            .model = if (thread.model_ref) |model_ref| model_ref else null,
            .reasoning_effort = thread.reasoning_effort,
            .approval_policy = approvalPolicyForMode(thread.provider, thread.access_mode),
            .sandbox_mode = sandboxModeForMode(thread.provider, thread.access_mode),
        });
    }

    fn beginSendDraft(self: *AppState, prompt: []const u8) !void {
        const page_alloc = std.heap.page_allocator;
        const project = self.currentProject();
        const thread = self.currentThread();

        const request = try page_alloc.create(SendWorkerRequest);
        errdefer page_alloc.destroy(request);
        request.* = .{
            .send_state_ptr = &self.send_state,
            .project_index = self.selected_project_index,
            .thread_index = self.currentProject().selected_thread_index,
            .provider = thread.provider,
            .harness = thread.harness,
            .project_path = try page_alloc.dupe(u8, project.path),
            .prompt = try page_alloc.dupe(u8, prompt),
            .image_path = if (thread.draft_image) |image| try page_alloc.dupe(u8, image.path) else null,
            .provider_thread_id = if (thread.provider_thread_id) |thread_id| try page_alloc.dupe(u8, thread_id) else null,
            .model_ref = if (thread.model_ref) |model_ref| try page_alloc.dupe(u8, model_ref) else null,
            .reasoning_effort = thread.reasoning_effort,
            .fast_mode = thread.fast_mode,
            .access_mode = thread.access_mode,
        };
        errdefer {
            page_alloc.free(request.project_path);
            page_alloc.free(request.prompt);
            if (request.image_path) |image_path| page_alloc.free(image_path);
            if (request.provider_thread_id) |thread_id| page_alloc.free(thread_id);
            if (request.model_ref) |model_ref| page_alloc.free(model_ref);
        }

        self.send_state.mutex.lock();
        defer self.send_state.mutex.unlock();
        self.send_state.status = .pending;
        self.send_state.result = null;
        self.send_state.error_message = null;
        self.send_state.provider = thread.provider;
        self.send_state.project_index = request.project_index;
        self.send_state.thread_index = request.thread_index;
        self.send_state.partial_text.clearRetainingCapacity();
        freePendingTimelineEventsLocked(page_alloc, &self.send_state.pending_events);
        freePendingDiffFilesLocked(page_alloc, &self.send_state.pending_diff_files);
        freePendingApprovalLocked(page_alloc, &self.send_state.pending_approval);
        self.send_state.approval_decision = null;
        self.send_state.worker = try std.Thread.spawn(.{}, sendWorker, .{ &self.send_state, request });
    }

    fn applyPersisted(self: *AppState, persisted: PersistedState) !void {
        if (persisted.projects.len == 0) {
            self.selected_project_index = 0;
            self.next_project_number = 1;
            self.syncRenameBuffer();
            self.dirty = false;
            return;
        }

        for (persisted.projects, 0..) |project, index| {
            const project_id = if (project.id) |persisted_id|
                try self.allocator.dupe(u8, persisted_id)
            else
                try self.deriveProjectId(project.path);
            defer self.allocator.free(project_id);

            var loaded = try Project.init(self.allocator, project_id, project.label, project.path, project.unread_count);
            loaded.collapsed = project.collapsed orelse false;
            loaded.thread_list_expanded = project.thread_list_expanded orelse false;
            for (loaded.threads.items) |*thread| {
                thread.deinit(self.allocator);
            }
            loaded.threads.clearRetainingCapacity();

            if (project.threads) |threads| {
                for (threads) |persisted_thread| {
                    var thread = try ChatThread.init(self.allocator, persisted_thread.title);
                    thread.committed = persisted_thread.committed;
                    thread.last_activity_at = persisted_thread.last_activity_at orelse 0;
                    thread.provider_thread_id = if (persisted_thread.provider_thread_id) |thread_id|
                        try self.allocator.dupeZ(u8, thread_id)
                    else
                        null;
                    if (thread.model_ref) |model_ref| {
                        self.allocator.free(model_ref);
                    }
                    thread.model_ref = if (persisted_thread.model_ref) |model_ref|
                        try self.allocator.dupeZ(u8, model_ref)
                    else
                        null;
                    thread.reasoning_effort = persisted_thread.reasoning_effort;
                    thread.fast_mode = persisted_thread.fast_mode orelse .off;
                    thread.access_mode = persisted_thread.access_mode orelse .full_access;
                    thread.provider = persisted_thread.provider;
                    thread.harness = persisted_thread.harness;
                    thread.setDraft(persisted_thread.draft);
                    if (persisted_thread.draft_image) |image| {
                        try thread.setDraftImage(self.allocator, image.path, image.mime, image.byte_size);
                    }
                    for (persisted_thread.messages) |message| {
                        try thread.messages.append(self.allocator, .{
                            .role = message.role,
                            .author = try self.dupeZ(message.author),
                            .body = try self.dupeZ(message.body),
                            .image = if (message.image) |image|
                                try ChatImageAttachment.init(self.allocator, image.path, image.mime, image.byte_size)
                            else
                                null,
                        });
                    }
                    if (thread.last_activity_at == 0 and thread.messages.items.len > 0) {
                        thread.touch();
                    }
                    try loaded.threads.append(self.allocator, thread);
                }
                if (loaded.threads.items.len == 0) {
                    try loaded.addThread(self.allocator);
                }
                loaded.selected_thread_index = @min(project.selected_thread_index, loaded.threads.items.len - 1);
            } else {
                var thread = try ChatThread.init(self.allocator, "New thread");
                thread.committed = project.messages.len > 0;
                thread.last_activity_at = if (thread.committed) std.time.timestamp() else 0;
                thread.provider = project.provider;
                thread.harness = project.harness;
                thread.setDraft(project.draft);
                for (project.messages) |message| {
                    try thread.messages.append(self.allocator, .{
                        .role = message.role,
                        .author = try self.dupeZ(message.author),
                        .body = try self.dupeZ(message.body),
                        .image = if (message.image) |image|
                            try ChatImageAttachment.init(self.allocator, image.path, image.mime, image.byte_size)
                        else
                            null,
                    });
                }
                try loaded.threads.append(self.allocator, thread);
                loaded.selected_thread_index = 0;
            }

            if (index == 0 and project.messages.len == 0 and project.threads == null and persisted.messages != null) {
                var fallback_thread = loaded.currentThreadMutable();
                fallback_thread.provider = persisted.provider orelse fallback_thread.provider;
                fallback_thread.harness = persisted.harness orelse fallback_thread.harness;
                if (persisted.draft) |draft| fallback_thread.setDraft(draft);
                for (persisted.messages.?) |message| {
                    try fallback_thread.messages.append(self.allocator, .{
                        .role = message.role,
                        .author = try self.dupeZ(message.author),
                        .body = try self.dupeZ(message.body),
                        .image = if (message.image) |image|
                            try ChatImageAttachment.init(self.allocator, image.path, image.mime, image.byte_size)
                        else
                            null,
                    });
                }
            }

            try loaded.normalize(self.allocator);

            try self.projects.append(self.allocator, loaded);
        }

        self.selected_project_index = @min(persisted.selected_project_index, self.projects.items.len - 1);
        self.next_project_number = self.projects.items.len + 1;
        self.syncRenameBuffer();
        self.requestTranscriptScrollToBottom();
        self.dirty = false;
    }

    fn seedDefaultState(self: *AppState) !void {
        self.selected_project_index = 0;
        self.next_project_number = 1;
        self.syncRenameBuffer();
        self.requestTranscriptScrollToBottom();
        self.dirty = false;
    }

    fn currentProject(self: *const AppState) *const Project {
        return &self.projects.items[self.selected_project_index];
    }

    fn currentProjectMutable(self: *AppState) *Project {
        return &self.projects.items[self.selected_project_index];
    }

    fn attachClipboardImageToCurrentDraft(self: *AppState) void {
        const capture = captureClipboardImage(self.allocator) catch |err| {
            log.err("failed to capture clipboard image: {s}", .{@errorName(err)});
            self.setSidebarNotice("Clipboard image paste failed.");
            return;
        };
        if (capture == null) {
            self.setSidebarNotice("No image found on the clipboard.");
            return;
        }

        const image = capture.?;
        defer self.allocator.free(image.bytes);

        const image_path = self.writeClipboardImageToStorage(image.mime, image.bytes) catch |err| {
            log.err("failed to persist clipboard image: {s}", .{@errorName(err)});
            self.setSidebarNotice("Failed to save clipboard image.");
            return;
        };
        defer self.allocator.free(image_path);

        const thread = self.currentThreadMutable();
        thread.setDraftImage(self.allocator, image_path, image.mime, image.bytes.len) catch |err| {
            log.err("failed to attach draft image: {s}", .{@errorName(err)});
            self.setSidebarNotice("Failed to attach clipboard image.");
            return;
        };
        self.setSidebarNotice("Clipboard image attached.");
        self.markDirty();
    }

    fn clearCurrentDraftImage(self: *AppState) void {
        const thread = self.currentThreadMutable();
        if (thread.draft_image) |image| {
            std.fs.deleteFileAbsolute(image.path) catch {};
            self.evictCachedImageTexture(image.path);
            if (self.modal_image_path) |modal_path| {
                if (std.mem.eql(u8, modal_path, image.path)) {
                    self.allocator.free(modal_path);
                    self.modal_image_path = null;
                }
            }
        }
        thread.clearDraftImage(self.allocator);
        self.markDirty();
    }

    fn ensureImageTexture(self: *AppState, path: [:0]const u8) ?CachedImageTexture {
        if (self.image_texture_cache.getPtr(path)) |cached| {
            return if (cached.valid) cached.* else null;
        }

        const owned_key = self.allocator.dupe(u8, path) catch return null;
        errdefer self.allocator.free(owned_key);

        const loaded = stb_image.load(path) catch |err| {
            log.err("failed to decode attachment preview {s}: {s}", .{ path, @errorName(err) });
            self.image_texture_cache.put(owned_key, .{
                .texture_id = 0,
                .width = 0,
                .height = 0,
                .valid = false,
            }) catch self.allocator.free(owned_key);
            return null;
        };
        defer loaded.deinit();

        var textures = [_]c_uint{0};
        glGenTextures(1, &textures);
        const texture_id = textures[0];
        if (texture_id == 0) {
            self.image_texture_cache.put(owned_key, .{
                .texture_id = 0,
                .width = 0,
                .height = 0,
                .valid = false,
            }) catch self.allocator.free(owned_key);
            return null;
        }

        glBindTexture(GL_TEXTURE_2D, texture_id);
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexImage2D(
            GL_TEXTURE_2D,
            0,
            GL_RGBA,
            @intCast(loaded.width),
            @intCast(loaded.height),
            0,
            GL_RGBA,
            GL_UNSIGNED_BYTE,
            loaded.pixels,
        );
        glBindTexture(GL_TEXTURE_2D, 0);

        const cached: CachedImageTexture = .{
            .texture_id = texture_id,
            .width = loaded.width,
            .height = loaded.height,
            .valid = true,
        };

        self.image_texture_cache.put(owned_key, cached) catch {
            cached.deinit();
            return null;
        };
        return cached;
    }

    fn evictCachedImageTexture(self: *AppState, path: []const u8) void {
        if (self.image_texture_cache.fetchRemove(path)) |entry| {
            self.allocator.free(entry.key);
            entry.value.deinit();
        }
    }

    fn releaseAllImageTextures(self: *AppState) void {
        var it = self.image_texture_cache.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit();
        }
        self.image_texture_cache.deinit();
    }

    fn openImageModal(self: *AppState, path: [:0]const u8) void {
        if (self.modal_image_path) |existing| {
            if (std.mem.eql(u8, existing, path)) {
                zgui.openPopup(IMAGE_MODAL_ID, .{});
                return;
            }
            self.allocator.free(existing);
        }
        self.modal_image_path = self.allocator.dupeZ(u8, path) catch return;
        zgui.openPopup(IMAGE_MODAL_ID, .{});
    }

    fn closeImageModal(self: *AppState) void {
        if (self.modal_image_path) |path| {
            self.allocator.free(path);
            self.modal_image_path = null;
        }
    }

    fn writeClipboardImageToStorage(self: *AppState, mime: []const u8, bytes: []const u8) ![]u8 {
        const images_dir = try std.fs.path.join(self.allocator, &.{ self.storage.pref_path, "clipboard-images" });
        defer self.allocator.free(images_dir);
        std.fs.makeDirAbsolute(images_dir) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return err,
        };

        const ext = extensionForImageMime(mime);
        const timestamp_ms = @as(u64, @intCast(@max(@as(i64, 0), std.time.milliTimestamp())));
        var attempt: usize = 0;
        while (attempt < 256) : (attempt += 1) {
            const file_name = if (attempt == 0)
                try std.fmt.allocPrint(self.allocator, "clipboard-{d}.{s}", .{ timestamp_ms, ext })
            else
                try std.fmt.allocPrint(self.allocator, "clipboard-{d}-{d}.{s}", .{ timestamp_ms, attempt, ext });
            defer self.allocator.free(file_name);

            const image_path = try std.fs.path.join(self.allocator, &.{ images_dir, file_name });
            errdefer self.allocator.free(image_path);

            const file = std.fs.createFileAbsolute(image_path, .{ .exclusive = true });
            if (file) |created| {
                defer created.close();
                try created.writeAll(bytes);
                return image_path;
            } else |err| switch (err) {
                error.PathAlreadyExists => {
                    self.allocator.free(image_path);
                    continue;
                },
                else => return err,
            }
        }

        return error.PathAlreadyExists;
    }

    fn currentDraft(self: *const AppState) []const u8 {
        return self.currentProject().currentDraft();
    }

    fn currentThread(self: *const AppState) *const ChatThread {
        return self.currentProject().currentThread();
    }

    fn currentThreadMutable(self: *AppState) *ChatThread {
        return self.currentProjectMutable().currentThreadMutable();
    }

    fn draftBuffer(self: *AppState) [:0]u8 {
        return self.currentProjectMutable().draftBuffer();
    }

    fn setDraft(self: *AppState, value: []const u8) void {
        self.currentProjectMutable().setDraft(value);
        self.markDirty();
    }

    fn clearDraft(self: *AppState) void {
        self.currentProjectMutable().clearDraft();
        self.markDirty();
    }

    fn markDirty(self: *AppState) void {
        self.dirty = true;
    }

    fn requestTranscriptScrollToBottom(self: *AppState) void {
        self.scroll_transcript_to_bottom = true;
    }

    fn importPath(self: *const AppState) []const u8 {
        return std.mem.sliceTo(self.import_path_storage[0..], 0);
    }

    fn importPathBuffer(self: *AppState) [:0]u8 {
        return self.import_path_storage[0 .. self.import_path_storage.len - 1 :0];
    }

    fn clearImportPath(self: *AppState) void {
        self.import_path_storage[0] = 0;
    }

    fn setImportPath(self: *AppState, value: []const u8) void {
        @memset(&self.import_path_storage, 0);
        const len = @min(value.len, self.import_path_storage.len - 1);
        @memcpy(self.import_path_storage[0..len], value[0..len]);
    }

    fn renameInput(self: *const AppState) []const u8 {
        return std.mem.sliceTo(self.rename_storage[0..], 0);
    }

    fn renameBuffer(self: *AppState) [:0]u8 {
        return self.rename_storage[0 .. self.rename_storage.len - 1 :0];
    }

    fn syncRenameBuffer(self: *AppState) void {
        if (self.projects.items.len == 0) {
            self.rename_storage[0] = 0;
            return;
        }
        @memset(&self.rename_storage, 0);
        const label = self.currentProject().label;
        const len = @min(label.len, self.rename_storage.len - 1);
        @memcpy(self.rename_storage[0..len], label[0..len]);
    }

    fn sidebarNotice(self: *const AppState) []const u8 {
        return std.mem.sliceTo(self.sidebar_notice_storage[0..], 0);
    }

    fn setSidebarNotice(self: *AppState, value: []const u8) void {
        @memset(&self.sidebar_notice_storage, 0);
        const len = @min(value.len, self.sidebar_notice_storage.len - 1);
        @memcpy(self.sidebar_notice_storage[0..len], value[0..len]);
    }

    fn flushIfDirty(self: *AppState) void {
        if (!self.dirty) return;

        self.storage.save(self) catch |err| {
            log.err("failed to save native state: {s}", .{@errorName(err)});
            return;
        };
        self.dirty = false;
    }

    fn reloadFromStorage(self: *AppState) !void {
        self.flushIfDirty();
        self.clearProjects();

        if (try self.storage.load(self.allocator)) |persisted| {
            defer persisted.deinit();
            try self.applyPersisted(persisted.value);
        } else {
            try self.seedDefaultState();
        }

        self.setSidebarNotice("App refreshed from disk.");
        self.requestTranscriptScrollToBottom();
    }

    fn dupeZ(self: *AppState, value: []const u8) ![:0]const u8 {
        return try self.allocator.dupeZ(u8, value);
    }

    fn deinit(self: *AppState) void {
        self.finishPickerThread();
        self.finishSendThread();
        self.send_state.partial_text.deinit(std.heap.page_allocator);
        freePendingTimelineEvents(std.heap.page_allocator, &self.send_state.pending_events);
        freePendingDiffFiles(std.heap.page_allocator, &self.send_state.pending_diff_files);
        freePendingApproval(std.heap.page_allocator, &self.send_state.pending_approval);
        self.releaseAllImageTextures();
        if (self.modal_image_path) |path| self.allocator.free(path);
        self.clearProjects();
        self.projects.deinit(self.allocator);
    }

    fn pollPicker(self: *AppState) void {
        var picked_path: ?[]u8 = null;
        var next_status: PickerStatus = .idle;

        self.picker_state.mutex.lock();
        switch (self.picker_state.status) {
            .selected => {
                picked_path = self.picker_state.selected_path;
                self.picker_state.selected_path = null;
                self.picker_state.status = .idle;
                next_status = .selected;
            },
            .cancelled => {
                self.picker_state.status = .idle;
                next_status = .cancelled;
            },
            .unavailable => {
                self.picker_state.status = .idle;
                next_status = .unavailable;
            },
            .failed => {
                self.picker_state.status = .idle;
                next_status = .failed;
            },
            else => {},
        }
        self.picker_state.mutex.unlock();

        if (next_status != .idle) {
            self.finishPickerThread();
        }

        switch (next_status) {
            .selected => {
                if (picked_path) |path| {
                    defer std.heap.page_allocator.free(path);
                    self.setImportPath(path);
                    self.setSidebarNotice("Folder selected.");
                }
            },
            .cancelled => self.setSidebarNotice("Folder selection cancelled."),
            .unavailable => self.setSidebarNotice("No folder picker found. Paste a directory path manually."),
            .failed => self.setSidebarNotice("Folder picker failed."),
            else => {},
        }
    }

    fn pollSend(self: *AppState) void {
        var completed_result: ?SendResultPayload = null;
        var failed_message: ?[]u8 = null;
        var next_status: SendStatus = .idle;
        var completed_events: std.ArrayListUnmanaged(PendingTimelineEvent) = .empty;
        var completed_diff_files: std.ArrayListUnmanaged(PendingDiffFile) = .empty;

        self.send_state.mutex.lock();
        switch (self.send_state.status) {
            .completed => {
                completed_result = self.send_state.result;
                self.send_state.result = null;
                flushPendingAssistantTextLocked(&self.send_state, std.heap.page_allocator);
                completed_events = self.send_state.pending_events;
                self.send_state.pending_events = .empty;
                completed_diff_files = self.send_state.pending_diff_files;
                self.send_state.pending_diff_files = .empty;
                freePendingApprovalLocked(std.heap.page_allocator, &self.send_state.pending_approval);
                self.send_state.approval_decision = null;
                self.send_state.provider = null;
                self.send_state.project_index = null;
                self.send_state.thread_index = null;
                self.send_state.status = .idle;
                next_status = .completed;
            },
            .failed => {
                failed_message = self.send_state.error_message;
                self.send_state.error_message = null;
                self.send_state.partial_text.clearRetainingCapacity();
                freePendingTimelineEventsLocked(std.heap.page_allocator, &self.send_state.pending_events);
                freePendingDiffFilesLocked(std.heap.page_allocator, &self.send_state.pending_diff_files);
                freePendingApprovalLocked(std.heap.page_allocator, &self.send_state.pending_approval);
                self.send_state.approval_decision = null;
                self.send_state.provider = null;
                self.send_state.project_index = null;
                self.send_state.thread_index = null;
                self.send_state.status = .idle;
                next_status = .failed;
            },
            else => {},
        }
        self.send_state.mutex.unlock();

        if (next_status != .idle) {
            self.finishSendThread();
        }

        switch (next_status) {
            .completed => {
                if (completed_result) |result| {
                    defer std.heap.page_allocator.free(result.provider_thread_id);
                    defer std.heap.page_allocator.free(result.reply_text);
                    defer freePendingTimelineEvents(std.heap.page_allocator, &completed_events);
                    defer freePendingDiffFiles(std.heap.page_allocator, &completed_diff_files);
                    appendPendingDiffSummaryEvent(std.heap.page_allocator, &completed_events, completed_diff_files.items);
                    const should_append_reply_text = !pendingTimelineEventsContainAssistant(completed_events.items);
                    self.applyPendingTimelineEvents(result, &completed_events) catch |err| {
                        log.err("failed to apply timeline events: {s}", .{@errorName(err)});
                    };
                    self.applySendSuccess(result, should_append_reply_text) catch |err| {
                        log.err("failed to apply send result: {s}", .{@errorName(err)});
                        self.setSidebarNotice("Failed to apply provider reply.");
                    };
                }
            },
            .failed => {
                if (failed_message) |message| {
                    defer std.heap.page_allocator.free(message);
                    self.setSidebarNotice(message);
                } else {
                    self.setSidebarNotice("Provider request failed.");
                }
            },
            else => {},
        }
    }

    fn finishPickerThread(self: *AppState) void {
        self.picker_state.mutex.lock();
        const maybe_worker = self.picker_state.worker;
        self.picker_state.worker = null;
        self.picker_state.mutex.unlock();

        if (maybe_worker) |worker| {
            worker.join();
        }
    }

    fn finishSendThread(self: *AppState) void {
        self.send_state.mutex.lock();
        const maybe_worker = self.send_state.worker;
        self.send_state.worker = null;
        self.send_state.mutex.unlock();

        if (maybe_worker) |worker| {
            worker.join();
        }
    }

    fn hasPendingStream(self: *AppState) bool {
        self.send_state.mutex.lock();
        defer self.send_state.mutex.unlock();

        if (self.send_state.status != .pending) return false;
        if (self.send_state.project_index != self.selected_project_index) return false;
        if (self.send_state.thread_index != self.currentProject().selected_thread_index) return false;
        return true;
    }

    fn pendingApprovalSnapshot(self: *AppState) !?PendingApproval {
        self.send_state.mutex.lock();
        defer self.send_state.mutex.unlock();

        if (self.send_state.status != .pending) return null;
        if (self.send_state.project_index != self.selected_project_index) return null;
        if (self.send_state.thread_index != self.currentProject().selected_thread_index) return null;
        const approval = self.send_state.pending_approval orelse return null;
        return .{
            .call_id = try self.allocator.dupe(u8, approval.call_id),
            .title = try self.allocator.dupe(u8, approval.title),
            .body = try self.allocator.dupe(u8, approval.body),
        };
    }

    fn resolvePendingApproval(self: *AppState, decision: ai_harness.ApprovalDecision) void {
        self.send_state.mutex.lock();
        defer self.send_state.mutex.unlock();
        if (self.send_state.pending_approval == null) return;
        self.send_state.approval_decision = decision;
        self.send_state.condition.broadcast();
    }

    fn applySendSuccess(self: *AppState, result: SendResultPayload, append_reply_text: bool) !void {
        if (result.project_index >= self.projects.items.len) return;
        const project = &self.projects.items[result.project_index];
        if (result.thread_index >= project.threads.items.len) return;
        const thread = &project.threads.items[result.thread_index];

        if (thread.provider_thread_id) |thread_id| {
            self.allocator.free(thread_id);
        }
        thread.provider_thread_id = try self.allocator.dupeZ(u8, result.provider_thread_id);
        if (!append_reply_text) {
            thread.touch();
            self.markDirty();
            self.setSidebarNotice("Provider session updated.");
            return;
        }
        if (std.mem.trim(u8, result.reply_text, &std.ascii.whitespace).len > 0 and thread.messages.items.len > 0) {
            const last_message = thread.messages.items[thread.messages.items.len - 1];
            if (last_message.role != .assistant or !std.mem.eql(u8, last_message.body, result.reply_text)) {
                try thread.messages.append(self.allocator, .{
                    .role = .assistant,
                    .author = try self.dupeZ(providerLabel(thread.provider)),
                    .body = try self.dupeZ(result.reply_text),
                    .image = null,
                });
            }
        } else if (std.mem.trim(u8, result.reply_text, &std.ascii.whitespace).len > 0) {
            try thread.messages.append(self.allocator, .{
                .role = .assistant,
                .author = try self.dupeZ(providerLabel(thread.provider)),
                .body = try self.dupeZ(result.reply_text),
                .image = null,
            });
        }
        thread.touch();
        self.markDirty();
        self.setSidebarNotice("Provider session updated.");
    }

    fn applyPendingTimelineEvents(self: *AppState, result: SendResultPayload, events: *std.ArrayListUnmanaged(PendingTimelineEvent)) !void {
        if (events.items.len == 0) return;
        if (result.project_index >= self.projects.items.len) return;
        const project = &self.projects.items[result.project_index];
        if (result.thread_index >= project.threads.items.len) return;
        const thread = &project.threads.items[result.thread_index];

        for (events.items) |event| {
            try thread.messages.append(self.allocator, .{
                .role = event.role,
                .author = try self.dupeZ(event.author),
                .body = try self.dupeZ(event.body),
                .image = null,
            });
        }
        thread.touch();
        self.markDirty();
    }

    fn resolveProjectPath(self: *AppState, raw_path: []const u8) ![]u8 {
        const expanded = if (std.mem.startsWith(u8, raw_path, "~/")) blk: {
            const home = std.posix.getenv("HOME") orelse return error.EnvironmentVariableNotFound;
            break :blk try std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ home, raw_path[2..] });
        } else try self.allocator.dupe(u8, raw_path);
        defer self.allocator.free(expanded);

        const resolved = if (std.fs.path.isAbsolute(expanded))
            try std.fs.realpathAlloc(self.allocator, expanded)
        else blk: {
            const cwd = std.fs.cwd();
            break :blk try cwd.realpathAlloc(self.allocator, expanded);
        };

        var dir = try std.fs.openDirAbsolute(resolved, .{});
        dir.close();
        return resolved;
    }

    fn findProjectIndexByPath(self: *const AppState, path: []const u8) ?usize {
        for (self.projects.items, 0..) |project, index| {
            if (std.mem.eql(u8, project.path, path)) return index;
        }
        return null;
    }

    fn deriveProjectId(self: *AppState, path: []const u8) ![]u8 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(path);
        return std.fmt.allocPrint(self.allocator, "{x}", .{hasher.final()});
    }

    fn clearProjects(self: *AppState) void {
        for (self.projects.items) |*project| {
            project.deinit(self.allocator);
        }
        self.projects.clearRetainingCapacity();
        self.selected_project_index = 0;
        self.next_project_number = 1;
        self.show_project_creator = false;
        self.clearImportPath();
        self.rename_storage[0] = 0;
        self.dirty = false;
    }

    fn defaultExplorerPath(self: *AppState) ![]u8 {
        if (self.importPath().len > 0) {
            return self.resolveProjectPath(std.mem.trim(u8, self.importPath(), &std.ascii.whitespace));
        }

        if (self.projects.items.len > 0) {
            if (self.resolveProjectPath(self.currentProject().path)) |resolved| {
                return resolved;
            } else |_| {}
        }

        const home = std.posix.getenv("HOME") orelse return self.allocator.dupe(u8, ".");
        return self.allocator.dupe(u8, home);
    }
};

pub fn main() !void {
    var gpa_state: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa_state.deinit();
    const allocator = gpa_state.allocator();

    try sdl.setAppMetadata("Verde Native", "0.0.0", "com.verde.native");
    try sdl.init(.{ .video = true, .events = true });
    defer sdl.quit();

    var storage = try Storage.init(allocator);
    defer storage.deinit();

    try sdl.gl.setAttribute(.context_major_version, 3);
    try sdl.gl.setAttribute(.context_minor_version, 3);
    try sdl.gl.setAttribute(.doublebuffer, 1);
    switch (@import("builtin").os.tag) {
        .macos => try sdl.gl.setAttribute(.context_profile_mask, @intFromEnum(sdl.gl.Profile.core)),
        else => {},
    }

    const initial_window_frame = initialWindowFrame();
    const window = try sdl.Window.create(
        "Verde",
        initial_window_frame.w,
        initial_window_frame.h,
        .{
            .resizable = true,
            .high_pixel_density = true,
            .opengl = true,
        },
    );
    defer window.destroy();
    _ = SDL_SetWindowPosition(window, initial_window_frame.x, initial_window_frame.y);

    const gl_context = try sdl.gl.createContext(window);
    defer sdl.gl.destroyContext(gl_context);
    try sdl.gl.makeCurrent(window, gl_context);
    try sdl.gl.setSwapInterval(1);

    const ui_config = app_config.loadAppConfig(allocator) catch |err| blk: {
        log.warn("failed to load app config: {s}", .{@errorName(err)});
        break :blk app_config.AppConfig{ .font_size = DEFAULT_FONT_SIZE };
    };

    zgui.init(allocator);
    defer zgui.deinit();
    installFonts(ui_config.font_size);
    zgui.backend.init(window, gl_context);
    defer zgui.backend.deinit();

    var ui_scale = currentWindowDisplayScale(window);
    applyTheme(ui_scale);

    var state = try AppState.init(allocator, &storage);
    defer state.deinit();
    var keyboard = try keybinds.NativeKeyboardConfig.load(allocator);
    defer keyboard.deinit();

    var running = true;
    while (running) {
        running = processEvents(&state, &keyboard);
        state.pollPicker();
        state.pollSend();

        var fb_width: c_int = 0;
        var fb_height: c_int = 0;
        getWindowSizeInPixels(window, &fb_width, &fb_height);

        const next_ui_scale = currentWindowDisplayScale(window);
        if (@abs(next_ui_scale - ui_scale) > 0.01) {
            ui_scale = next_ui_scale;
            applyTheme(ui_scale);
        }

        zgui.backend.newFrame(@intCast(fb_width), @intCast(fb_height));
        renderRoot(&state, @floatFromInt(fb_width), @floatFromInt(fb_height));
        state.flushIfDirty();

        glClearColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2], 1.0);
        glClear(GL_COLOR_BUFFER_BIT);
        zgui.backend.draw();
        try sdl.gl.swapWindow(window);
    }
}

const WindowFrame = struct {
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
};

fn initialWindowFrame() WindowFrame {
    const display_id = SDL_GetPrimaryDisplay();
    if (display_id == .invalid) {
        return .{
            .x = sdl.Window.pos_centered,
            .y = sdl.Window.pos_centered,
            .w = DEFAULT_WINDOW_WIDTH,
            .h = DEFAULT_WINDOW_HEIGHT,
        };
    }

    var usable_bounds: SdlRect = undefined;
    if (!SDL_GetDisplayUsableBounds(display_id, &usable_bounds)) {
        return .{
            .x = sdl.Window.pos_centered,
            .y = sdl.Window.pos_centered,
            .w = DEFAULT_WINDOW_WIDTH,
            .h = DEFAULT_WINDOW_HEIGHT,
        };
    }

    const width = clampInt(@intFromFloat(@as(f32, @floatFromInt(usable_bounds.w)) * 0.72), MIN_WINDOW_WIDTH, @min(MAX_WINDOW_WIDTH, usable_bounds.w - 40));
    const height = clampInt(@intFromFloat(@as(f32, @floatFromInt(usable_bounds.h)) * 0.74), MIN_WINDOW_HEIGHT, @min(MAX_WINDOW_HEIGHT, usable_bounds.h - 40));
    const x = usable_bounds.x + @divTrunc(usable_bounds.w - width, 2);
    const y = usable_bounds.y + @divTrunc(usable_bounds.h - height, 2);
    return .{ .x = x, .y = y, .w = width, .h = height };
}

fn getWindowSizeInPixels(window: *sdl.Window, w: ?*c_int, h: ?*c_int) void {
    if (!SDL_GetWindowSizeInPixels(window, w, h)) {
        window.getSize(w, h) catch {
            if (w) |width| width.* = DEFAULT_WINDOW_WIDTH;
            if (h) |height| height.* = DEFAULT_WINDOW_HEIGHT;
        };
    }
}

fn currentWindowDisplayScale(window: *sdl.Window) f32 {
    const scale = SDL_GetWindowDisplayScale(window);
    if (!std.math.isFinite(scale) or scale <= 0.0) return 1.0;
    return clampf(scale, 1.0, 2.5);
}

fn clampInt(value: c_int, min_value: c_int, max_value: c_int) c_int {
    return @max(min_value, @min(value, max_value));
}

fn clampf(value: f32, min_value: f32, max_value: f32) f32 {
    return @max(min_value, @min(value, max_value));
}

fn uiScaleFactor() f32 {
    const font_size = zgui.getFontSize();
    if (!std.math.isFinite(font_size) or font_size <= 0.0) return 1.0;
    return clampf(font_size / RESPONSIVE_BASE_FONT_SIZE, 0.9, 2.4);
}

fn scaledUi(value: f32) f32 {
    return value * uiScaleFactor();
}

fn processEvents(state: *AppState, keyboard: *keybinds.NativeKeyboardConfig) bool {
    var event: sdl.Event = undefined;
    while (sdl.pollEvent(&event)) {
        _ = zgui.backend.processEvent(&event);
        switch (event.type) {
            .quit => return false,
            .key_down => {
                if (shouldPasteClipboardImage(state, &event.key)) {
                    state.attachClipboardImageToCurrentDraft();
                    continue;
                }
                const action = keyboard.actionForEvent(&event.key) orelse continue;
                handleKeyboardAction(state, keyboard, action);
            },
            else => {},
        }
    }

    return true;
}

fn shouldPasteClipboardImage(state: *const AppState, event: *const sdl.KeyboardEvent) bool {
    if (!state.composer_focused) return false;
    if (!event.down or event.repeat) return false;
    if (event.scancode != .v) return false;
    const keyboard_state = sdl.getKeyboardState();
    return keyboard_state[@intFromEnum(sdl.Scancode.lctrl)] or keyboard_state[@intFromEnum(sdl.Scancode.rctrl)];
}

fn handleKeyboardAction(
    state: *AppState,
    keyboard: *keybinds.NativeKeyboardConfig,
    action: keybinds.NativeKeyboardAction,
) void {
    switch (action) {
        .refresh => reloadApplication(state, keyboard),
    }
}

fn reloadApplication(state: *AppState, keyboard: *keybinds.NativeKeyboardConfig) void {
    state.reloadFromStorage() catch |err| {
        log.err("failed to refresh native app state: {s}", .{@errorName(err)});
        state.setSidebarNotice("Refresh failed.");
        return;
    };

    const next_keyboard = keybinds.NativeKeyboardConfig.load(state.allocator) catch |err| {
        log.err("failed to refresh native keybinds: {s}", .{@errorName(err)});
        state.setSidebarNotice("App refreshed, but keybinds failed to reload.");
        return;
    };
    keyboard.deinit();
    keyboard.* = next_keyboard;
    state.setSidebarNotice("App and keybinds refreshed.");
}

fn renderRoot(state: *AppState, width: f32, height: f32) void {
    zgui.setNextWindowPos(.{ .x = 0.0, .y = 0.0 });
    zgui.setNextWindowSize(.{ .w = width, .h = height });

    const root_flags: zgui.WindowFlags = .{
        .no_title_bar = true,
        .no_resize = true,
        .no_move = true,
        .no_collapse = true,
        .no_bring_to_front_on_focus = true,
    };

    _ = zgui.begin("Native Chat Shell", .{ .flags = root_flags });
    defer zgui.end();

    const content = zgui.getContentRegionAvail();
    const gap = clampf(content[0] * 0.012, scaledUi(10.0), scaledUi(18.0));
    const sidebar_width = clampf(content[0] * 0.235, scaledUi(230.0), @min(scaledUi(360.0), content[0] * 0.38));
    const workspace_width = @max(content[0] - sidebar_width - gap, scaledUi(320.0));
    renderSidebar(state, sidebar_width, content[1]);
    zgui.sameLine(.{ .spacing = gap });
    renderChatWorkspace(state, workspace_width, content[1]);
    renderImageModal(state, width, height);
    renderProjectRenameModal(state, width, height);
}

fn renderImageModal(state: *AppState, width: f32, height: f32) void {
    const modal_path = state.modal_image_path orelse return;
    if (!zgui.isPopupOpen(IMAGE_MODAL_ID, .{})) {
        zgui.openPopup(IMAGE_MODAL_ID, .{});
    }

    const modal_padding_x: f32 = 22.0;
    const modal_padding_y: f32 = 20.0;
    const modal_width = @min(width * 0.78, 980.0);
    const modal_height = @min(height * 0.82, 760.0);
    zgui.setNextWindowPos(.{
        .x = width * 0.5,
        .y = height * 0.5,
        .cond = .appearing,
        .pivot_x = 0.5,
        .pivot_y = 0.5,
    });
    zgui.setNextWindowSize(.{
        .w = modal_width,
        .h = modal_height,
        .cond = .appearing,
    });
    zgui.pushStyleVar1f(.{ .idx = .window_rounding, .v = 16.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ modal_padding_x, modal_padding_y } });
    zgui.pushStyleVar2f(.{ .idx = .item_spacing, .v = .{ 10.0, 8.0 } });
    if (!zgui.beginPopupModal(IMAGE_MODAL_ID, .{
        .flags = .{
            .no_title_bar = true,
            .no_saved_settings = true,
        },
    })) {
        zgui.popStyleVar(.{ .count = 3 });
        return;
    }
    defer {
        zgui.endPopup();
        zgui.popStyleVar(.{ .count = 3 });
    }

    const window_pos = zgui.getWindowPos();
    const window_size = zgui.getWindowSize();
    const mouse_pos = zgui.getMousePos();
    const clicked_outside =
        zgui.isMouseClicked(.left) and
        (mouse_pos[0] < window_pos[0] or
            mouse_pos[1] < window_pos[1] or
            mouse_pos[0] > (window_pos[0] + window_size[0]) or
            mouse_pos[1] > (window_pos[1] + window_size[1]));
    if (clicked_outside) {
        state.closeImageModal();
        zgui.closeCurrentPopup();
        return;
    }

    const texture = state.ensureImageTexture(modal_path);
    const close_size: f32 = 28.0;
    const header_start = zgui.getCursorScreenPos();
    const header_avail = zgui.getContentRegionAvail();
    const header_gap: f32 = 12.0;
    const header_text_width = @max(header_avail[0] - close_size - header_gap, 160.0);
    const close_x = header_start[0] + header_avail[0] - close_size;
    zgui.setCursorScreenPos(.{ close_x, header_start[1] });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = rgba(46, 48, 56, 220) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = rgba(68, 70, 79, 240) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = rgba(90, 92, 102, 255) });
    if (zgui.button("x", .{ .w = close_size, .h = close_size })) {
        state.closeImageModal();
        zgui.closeCurrentPopup();
        zgui.popStyleColor(.{ .count = 3 });
        return;
    }
    zgui.popStyleColor(.{ .count = 3 });

    zgui.setCursorScreenPos(header_start);
    zgui.pushTextWrapPos(header_start[0] + header_text_width);
    zgui.textColored(COLOR_WHITE, "{s}", .{std.fs.path.basename(modal_path)});
    zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{modal_path});
    zgui.popTextWrapPos();

    const title_size = zgui.calcTextSize(std.fs.path.basename(modal_path), .{ .wrap_width = header_text_width });
    const path_size = zgui.calcTextSize(modal_path, .{ .wrap_width = header_text_width });
    const header_height = @max(title_size[1] + path_size[1] + 8.0, close_size);
    zgui.setCursorScreenPos(.{ header_start[0], header_start[1] + header_height + 14.0 });
    zgui.separator();
    zgui.dummy(.{ .w = 0.0, .h = 6.0 });

    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 16.0, 16.0 } });
    _ = zgui.beginChild("AttachmentPreviewCanvas", .{
        .w = 0.0,
        .h = 0.0,
        .child_flags = .{ .border = true },
        .window_flags = .{},
    });
    defer {
        zgui.endChild();
        zgui.popStyleVar(.{ .count = 1 });
    }

    const avail = zgui.getContentRegionAvail();
    const image_max_w = @max(avail[0], 80.0);
    const image_max_h = @max(avail[1], 80.0);

    if (texture) |cached| {
        const dims = scaledImageSize(cached.width, cached.height, image_max_w, image_max_h);
        const x_offset = (image_max_w - dims[0]) * 0.5;
        const y_offset = (image_max_h - dims[1]) * 0.5;
        if (y_offset > 0.0) {
            zgui.dummy(.{ .w = 0.0, .h = y_offset });
        }
        if (x_offset > 0.0) zgui.setCursorPosX(zgui.getCursorPosX() + x_offset);
        zgui.image(textureRefFromGlId(cached.texture_id), .{
            .w = dims[0],
            .h = dims[1],
        });
    } else {
        _ = zgui.button("Preview unavailable", .{ .w = image_max_w, .h = @min(image_max_h, 240.0) });
    }
}

fn renderProjectRenameModal(state: *AppState, width: f32, height: f32) void {
    const rename_index = state.rename_project_index orelse return;
    if (rename_index >= state.projects.items.len) {
        state.rename_project_index = null;
        return;
    }

    if (!zgui.isPopupOpen(PROJECT_RENAME_MODAL_ID, .{})) {
        zgui.openPopup(PROJECT_RENAME_MODAL_ID, .{});
    }

    zgui.setNextWindowPos(.{
        .x = width * 0.5,
        .y = height * 0.5,
        .cond = .appearing,
        .pivot_x = 0.5,
        .pivot_y = 0.5,
    });
    zgui.setNextWindowSize(.{
        .w = clampf(width * 0.28, scaledUi(320.0), scaledUi(420.0)),
        .h = 0.0,
        .cond = .appearing,
    });
    zgui.pushStyleVar1f(.{ .idx = .window_rounding, .v = scaledUi(16.0) });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ scaledUi(18.0), scaledUi(18.0) } });
    zgui.pushStyleVar2f(.{ .idx = .item_spacing, .v = .{ scaledUi(10.0), scaledUi(10.0) } });
    var modal_open = true;
    if (!zgui.beginPopupModal(PROJECT_RENAME_MODAL_ID, .{
        .popen = &modal_open,
        .flags = .{ .no_saved_settings = true },
    })) {
        if (!modal_open) {
            state.cancelProjectRename();
        }
        zgui.popStyleVar(.{ .count = 3 });
        return;
    }
    defer {
        zgui.endPopup();
        zgui.popStyleVar(.{ .count = 3 });
    }

    if (zgui.isWindowAppearing()) {
        zgui.setKeyboardFocusHere(0);
    }

    zgui.textColored(COLOR_WHITE, "Rename project", .{});
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{state.projects.items[rename_index].path});

    const modal_width = zgui.getContentRegionAvail()[0];
    _ = zgui.inputTextWithHint("##project-rename-modal", .{
        .hint = "Project label",
        .buf = state.renameBuffer(),
    });

    const button_width = @max((modal_width - scaledUi(10.0)) * 0.5, scaledUi(96.0));
    zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.08) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.14) });
    if (zgui.button("Cancel", .{ .w = button_width, .h = scaledUi(34.0) })) {
        state.cancelProjectRename();
        zgui.closeCurrentPopup();
        zgui.popStyleColor(.{ .count = 3 });
        return;
    }
    zgui.popStyleColor(.{ .count = 3 });

    zgui.sameLine(.{ .spacing = scaledUi(10.0) });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_GREEN });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_GREEN, 0.10) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = darken(COLOR_GREEN, 0.10) });
    if (zgui.button("Rename", .{ .w = button_width, .h = scaledUi(34.0) })) {
        state.finishProjectRename();
        zgui.closeCurrentPopup();
        zgui.popStyleColor(.{ .count = 3 });
        return;
    }
    zgui.popStyleColor(.{ .count = 3 });
}

fn renderSidebar(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("ProjectsRail", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
        .window_flags = .{ .no_scrollbar = true },
    });
    defer zgui.endChild();

    const project_header_button_width = clampf(width * 0.11, scaledUi(28.0), scaledUi(38.0));
    const rail_inner_width = @max(width - scaledUi(22.0), scaledUi(140.0));
    if (heading_font) |font| {
        zgui.pushFont(font, heading_font_size);
        zgui.textColored(COLOR_WHITE, "Verde", .{});
        zgui.popFont();
    } else {
        zgui.textColored(COLOR_WHITE, "Verde", .{});
    }
    zgui.dummy(.{ .w = 0.0, .h = scaledUi(2.0) });
    zgui.textColored(COLOR_TEXT_MUTED, "PROJECTS", .{});
    zgui.sameLine(.{ .spacing = 0.0 });
    zgui.setCursorPosX(@max(zgui.getCursorPosX(), width - project_header_button_width - scaledUi(10.0)));
    if (state.show_project_creator) {
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.06) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.12) });
        if (zgui.button("x", .{ .w = project_header_button_width, .h = scaledUi(24.0) })) {
            state.show_project_creator = false;
            state.clearImportPath();
            state.setSidebarNotice("");
        }
        zgui.popStyleColor(.{ .count = 3 });
    } else {
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_GREEN });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_GREEN, 0.10) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = darken(COLOR_GREEN, 0.10) });
        if (zgui.button("+", .{ .w = project_header_button_width, .h = scaledUi(24.0) })) {
            state.show_project_creator = true;
            state.setSidebarNotice("");
        }
        zgui.popStyleColor(.{ .count = 3 });
    }

    if (state.show_project_creator) {
        const add_button_width = clampf(rail_inner_width * 0.24, scaledUi(60.0), scaledUi(92.0));
        const field_spacing = scaledUi(8.0);
        zgui.dummy(.{ .w = 0.0, .h = scaledUi(6.0) });
        zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ scaledUi(12.0), scaledUi(10.0) } });
        zgui.pushStyleVar2f(.{ .idx = .item_spacing, .v = .{ field_spacing, field_spacing } });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.05) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.10) });
        zgui.pushStyleColor4f(.{ .idx = .border, .c = lighten(COLOR_PANEL_MUTED, 0.08) });
        if (zgui.button("[]  Browse for folder", .{ .w = rail_inner_width, .h = scaledUi(40.0) })) {
            state.browseForProjectDirectory();
        }
        zgui.popStyleColor(.{ .count = 4 });

        zgui.pushItemWidth(@max(rail_inner_width - add_button_width - field_spacing, scaledUi(80.0)));
        _ = zgui.inputTextWithHint("##project-import", .{
            .hint = "/path/to/project",
            .buf = state.importPathBuffer(),
        });
        zgui.popItemWidth();
        zgui.sameLine(.{ .spacing = field_spacing });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_GREEN });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_GREEN, 0.10) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = darken(COLOR_GREEN, 0.10) });
        if (zgui.button("Add", .{ .w = add_button_width, .h = scaledUi(40.0) })) {
            state.importProjectFromInput() catch |err| {
                state.setSidebarNotice(@errorName(err));
            };
        }
        zgui.popStyleColor(.{ .count = 3 });

        if (state.sidebarNotice().len > 0) {
            zgui.textColored(COLOR_YELLOW, "{s}", .{state.sidebarNotice()});
        }
        zgui.popStyleVar(.{ .count = 2 });
        zgui.dummy(.{ .w = 0.0, .h = scaledUi(4.0) });
    }

    for (state.projects.items, 0..) |project, index| {
        zgui.pushIntId(@intCast(index));
        defer zgui.popId();

        const is_selected = state.selected_project_index == index;
        const is_collapsed = state.projects.items[index].collapsed;

        const project_action_width = clampf(width * 0.11, scaledUi(28.0), scaledUi(38.0));
        const row_width = @max(width - project_action_width - scaledUi(22.0), scaledUi(100.0));
        const row_height = scaledUi(28.0);

        // Full-width clickable row: chevron + folder icon + label
        {
            const row_pos = zgui.getCursorScreenPos();
            _ = zgui.invisibleButton("##project-row", .{ .w = row_width, .h = row_height });
            const left_clicked = zgui.isItemClicked(.left);
            const hovered = zgui.isItemHovered(.{});
            const dl = zgui.getWindowDrawList();

            // Hover/selected background
            if (is_selected or hovered) {
                const bg_col = if (is_selected and hovered)
                    rgba(44, 46, 54, 255)
                else if (is_selected)
                    rgba(38, 40, 48, 255)
                else
                    rgba(36, 38, 44, 255);
                dl.addRectFilled(.{
                    .pmin = row_pos,
                    .pmax = .{ row_pos[0] + row_width, row_pos[1] + row_height },
                    .col = zgui.colorConvertFloat4ToU32(bg_col),
                    .rounding = scaledUi(6.0),
                });
            }

            const cy = row_pos[1] + row_height * 0.5;
            var x = row_pos[0] + scaledUi(8.0);

            // Chevron icon
            const chevron_col = zgui.colorConvertFloat4ToU32(if (hovered) COLOR_TEXT_MUTED else COLOR_TEXT_SUBTLE);
            const cs: f32 = scaledUi(3.5);
            if (is_collapsed) {
                dl.addTriangleFilled(.{
                    .p1 = .{ x - cs * 0.3, cy - cs },
                    .p2 = .{ x + cs * 0.8, cy },
                    .p3 = .{ x - cs * 0.3, cy + cs },
                    .col = chevron_col,
                });
            } else {
                dl.addTriangleFilled(.{
                    .p1 = .{ x - cs, cy - cs * 0.3 },
                    .p2 = .{ x + cs, cy - cs * 0.3 },
                    .p3 = .{ x, cy + cs * 0.8 },
                    .col = chevron_col,
                });
            }
            x += scaledUi(12.0);

            // Folder icon
            const folder_col = zgui.colorConvertFloat4ToU32(COLOR_TEXT_SUBTLE);
            const fw = scaledUi(13.0);
            const fh = scaledUi(9.0);
            dl.addRectFilled(.{
                .pmin = .{ x, cy - fh * 0.5 - scaledUi(2.0) },
                .pmax = .{ x + fw * 0.4, cy - fh * 0.5 + scaledUi(1.0) },
                .col = folder_col,
                .rounding = scaledUi(1.0),
            });
            dl.addRectFilled(.{
                .pmin = .{ x, cy - fh * 0.5 },
                .pmax = .{ x + fw, cy + fh * 0.5 },
                .col = folder_col,
                .rounding = scaledUi(1.5),
            });
            x += fw + scaledUi(6.0);

            // Project label text
            const text_col = zgui.colorConvertFloat4ToU32(if (is_selected) COLOR_WHITE else COLOR_TEXT_MUTED);
            dl.addText(.{ x, cy - zgui.getFontSize() * 0.5 }, text_col, "{s}", .{project.label});

            if (left_clicked) {
                state.selected_project_index = index;
                state.projects.items[index].collapsed = !state.projects.items[index].collapsed;
                state.syncRenameBuffer();
                state.requestTranscriptScrollToBottom();
                state.markDirty();
            }

            if (zgui.beginPopupContextItem()) {
                defer zgui.endPopup();

                state.selected_project_index = index;
                state.syncRenameBuffer();

                if (zgui.menuItem("Rename project", .{})) {
                    state.beginProjectRename(index);
                    zgui.openPopup(PROJECT_RENAME_MODAL_ID, .{});
                    zgui.closeCurrentPopup();
                }
                if (zgui.menuItem("Remove project", .{})) {
                    state.removeProjectAtIndex(index);
                    zgui.closeCurrentPopup();
                }
            }
        }

        // "+" new chat button
        zgui.sameLine(.{ .spacing = scaledUi(6.0) });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.08) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.14) });
        if (zgui.button("+", .{ .w = project_action_width, .h = row_height })) {
            state.createThreadForProject(index);
        }
        if (zgui.isItemHovered(.{ .delay_normal = true })) {
            _ = zgui.beginTooltip();
            zgui.textUnformatted("Start a new chat");
            zgui.endTooltip();
        }
        zgui.popStyleColor(.{ .count = 3 });

        const active_thread = state.projects.items[index].currentThread();
        if (!is_collapsed) {
            zgui.textDisabled("{d} saved chats", .{project.committedThreadCount()});
        }
        if (is_selected and !is_collapsed) {
            zgui.indent(.{ .indent_w = scaledUi(12.0) });
            var sorted_indices = collectCommittedThreadIndicesSorted(state.allocator, &project) catch blk: {
                break :blk std.ArrayList(usize).empty;
            };
            defer sorted_indices.deinit(state.allocator);

            const show_all_threads = project.thread_list_expanded or sorted_indices.items.len <= SIDEBAR_VISIBLE_THREAD_LIMIT;
            const visible_count = if (show_all_threads) sorted_indices.items.len else @min(sorted_indices.items.len, SIDEBAR_VISIBLE_THREAD_LIMIT);

            for (sorted_indices.items[0..visible_count]) |thread_index| {
                const thread = &project.threads.items[thread_index];
                renderSidebarThreadRow(state, index, width, thread, thread_index);
            }

            if (sorted_indices.items.len > SIDEBAR_VISIBLE_THREAD_LIMIT) {
                zgui.dummy(.{ .w = 0.0, .h = scaledUi(4.0) });
                if (zgui.button(if (project.thread_list_expanded) "Show less" else "Show more", .{
                    .w = @max(width - scaledUi(36.0), scaledUi(110.0)),
                    .h = scaledUi(28.0),
                })) {
                    state.projects.items[index].thread_list_expanded = !state.projects.items[index].thread_list_expanded;
                    state.markDirty();
                }
                zgui.dummy(.{ .w = 0.0, .h = scaledUi(4.0) });
            }
            if (!active_thread.committed) {
                zgui.textColored(COLOR_TEXT_SUBTLE, "New chat will appear here after the first prompt.", .{});
            }
            zgui.unindent(.{ .indent_w = scaledUi(12.0) });
        } else if (!is_collapsed and active_thread.messages.items.len > 0) {
            var time_buf: [24]u8 = undefined;
            const relative_time = formatRelativeTime(&time_buf, active_thread.last_activity_at);
            zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{lastMessagePreview(&project)});
            zgui.textDisabled("{s}", .{relative_time});
        } else if (!is_collapsed and active_thread.committed) {
            zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{active_thread.title});
        } else if (!is_collapsed) {
            zgui.textColored(COLOR_TEXT_SUBTLE, "No saved threads yet", .{});
        }
        if (project.unread_count > 0) {
            zgui.sameLine(.{ .spacing = scaledUi(10.0) });
            zgui.textColored(COLOR_YELLOW, "{d} pending", .{project.unread_count});
        }
        zgui.spacing();
    }
}

fn renderChatWorkspace(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("ChatWorkspace", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
    });
    defer zgui.endChild();

    if (state.projects.items.len == 0) {
        zgui.textColored(COLOR_WHITE, "No projects yet", .{});
        zgui.textColored(COLOR_TEXT_MUTED, "Use the + button in the left rail, browse to a folder, then add its path here.", .{});
        return;
    }

    renderWorkspaceHeader(state);
    zgui.separator();

    const content = zgui.getContentRegionAvail();
    const composer_height = clampf(content[1] * 0.27, scaledUi(168.0), @min(content[1] * 0.42, scaledUi(320.0)));
    const transcript_height = @max(content[1] - composer_height - scaledUi(8.0), scaledUi(120.0));
    renderTranscript(state, content[0], transcript_height);
    renderComposer(state, content[0], @max(content[1] - transcript_height - scaledUi(8.0), scaledUi(120.0)));
}

fn renderWorkspaceHeader(state: *AppState) void {
    const project = state.currentProject();
    const thread = state.currentThread();
    zgui.dummy(.{ .w = 0.0, .h = 2.0 });
    zgui.textColored(COLOR_WHITE, "{s}", .{project.label});
    zgui.dummy(.{ .w = 0.0, .h = 1.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{project.path});
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}  |  {d} saved threads", .{
        if (thread.committed) thread.title else "New chat",
        project.committedThreadCount(),
    });
    zgui.dummy(.{ .w = 0.0, .h = 1.0 });
    zgui.textColored(rgba(124, 221, 94, 180), "Focused mode: chat only", .{});
    zgui.dummy(.{ .w = 0.0, .h = 4.0 });
}

fn renderTranscript(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("Transcript", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
    });
    defer zgui.endChild();

    const should_follow_stream = transcriptShouldAutoFollow(state);
    const has_pending_stream = state.hasPendingStream();
    if (state.currentThread().messages.items.len == 0 and !has_pending_stream) {
        zgui.textColored(COLOR_WHITE, "No messages yet", .{});
        zgui.textColored(COLOR_TEXT_MUTED, "Choose a provider, type a prompt below, and start the first chat for this directory.", .{});
        return;
    }

    for (state.currentThread().messages.items, 0..) |message, index| {
        renderTranscriptBubbleId(state, @intCast(index + 1), message.role, message.author, message.body, message.image);
        zgui.dummy(.{ .w = 0.0, .h = 10.0 });
    }

    if (has_pending_stream) {
        renderPendingApproval(state);
        renderPendingDiffCard(state);
        renderPendingTimelineEvents(state);
        renderPendingTranscriptBubble(state);
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    }

    if (state.scroll_transcript_to_bottom) {
        zgui.setScrollHereY(.{ .center_y_ratio = 1.0 });
        state.scroll_transcript_to_bottom = false;
    } else if (should_follow_stream) {
        zgui.setScrollHereY(.{ .center_y_ratio = 1.0 });
    }
}

fn renderPendingApproval(state: *AppState) void {
    var snapshot = state.pendingApprovalSnapshot() catch null;
    defer freePendingApproval(state.allocator, &snapshot);

    if (snapshot) |approval| {
        renderTranscriptBubble(state, "pending-approval-body", .system, approval.title, approval.body, null, false);
        const button_width = clampf(zgui.getContentRegionAvail()[0] * 0.28, scaledUi(108.0), scaledUi(180.0));
        zgui.dummy(.{ .w = 0.0, .h = scaledUi(6.0) });
        if (zgui.button("Approve", .{ .w = button_width, .h = scaledUi(34.0) })) {
            state.resolvePendingApproval(.approve);
        }
        zgui.sameLine(.{ .spacing = scaledUi(10.0) });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = rgba(52, 54, 60, 255) });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = rgba(64, 66, 74, 255) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = rgba(44, 46, 52, 255) });
        if (zgui.button("Deny", .{ .w = button_width, .h = scaledUi(34.0) })) {
            state.resolvePendingApproval(.deny);
        }
        zgui.popStyleColor(.{ .count = 3 });
        zgui.dummy(.{ .w = 0.0, .h = scaledUi(8.0) });
    }
}

fn renderPendingTimelineEvents(state: *AppState) void {
    state.send_state.mutex.lock();
    defer state.send_state.mutex.unlock();

    if (state.send_state.status != .pending) return;
    if (state.send_state.project_index != state.selected_project_index) return;
    if (state.send_state.thread_index != state.currentProject().selected_thread_index) return;

    for (state.send_state.pending_events.items, 0..) |event, index| {
        renderTranscriptMessage(state, @intCast(50_000 + index), event.role, event.author, event.body, null);
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    }
}

fn renderPendingDiffCard(state: *AppState) void {
    state.send_state.mutex.lock();
    defer state.send_state.mutex.unlock();

    if (state.send_state.status != .pending) return;
    if (state.send_state.project_index != state.selected_project_index) return;
    if (state.send_state.thread_index != state.currentProject().selected_thread_index) return;
    if (state.send_state.pending_diff_files.items.len == 0) return;

    renderPendingDiffCardLocked(&state.send_state.pending_diff_files);
    zgui.dummy(.{ .w = 0.0, .h = 6.0 });
}

fn renderPendingDiffCardLocked(files: *std.ArrayListUnmanaged(PendingDiffFile)) void {
    const totals = summarizePendingDiffFiles(files.items);
    const card_height = pendingDiffCardHeight(files.items);

    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 12.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 14.0, 10.0 } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(32, 33, 38, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(58, 60, 68, 255) });
    _ = zgui.beginChild("pending-diff-card", .{
        .w = 0.0,
        .h = card_height,
        .child_flags = .{ .border = true },
        .window_flags = .{
            .no_saved_settings = true,
        },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    renderChangedFilesHeader(files.items.len, totals.additions, totals.deletions);
    zgui.sameLine(.{ .spacing = 12.0 });
    if (renderChangedFilesAction("Expand all")) {
        for (files.items) |*file| file.expanded = true;
    }
    zgui.sameLine(.{ .spacing = 8.0 });
    if (renderChangedFilesAction("Collapse all")) {
        for (files.items) |*file| file.expanded = false;
    }
    zgui.dummy(.{ .w = 0.0, .h = 4.0 });

    for (files.items, 0..) |*file, index| {
        renderPendingDiffFile(file, index);
    }
}

fn renderPendingTranscriptBubble(state: *AppState) void {
    state.send_state.mutex.lock();
    defer state.send_state.mutex.unlock();

    if (state.send_state.status != .pending) return;
    if (state.send_state.project_index != state.selected_project_index) return;
    if (state.send_state.thread_index != state.currentProject().selected_thread_index) return;

    const stream_text = state.send_state.partial_text.items;
    renderTranscriptBubble(
        state,
        "pending-assistant",
        .assistant,
        providerLabel(state.currentThread().provider),
        if (stream_text.len > 0) stream_text else "Waiting for streamed output...",
        null,
        stream_text.len == 0,
    );
}

fn renderTranscriptBubbleId(state: *AppState, id: u32, role: ChatRole, author: []const u8, body: []const u8, image: ?ChatImageAttachment) void {
    renderTranscriptMessage(state, id, role, author, body, image);
}

fn renderTranscriptMessage(state: *AppState, id: u32, role: ChatRole, author: []const u8, body: []const u8, image: ?ChatImageAttachment) void {
    if (role == .system and std.mem.eql(u8, author, "Changed files")) {
        renderChangedFilesCardId(id, body);
        return;
    }
    if (role == .system and (std.mem.eql(u8, author, "Ran command") or std.mem.eql(u8, author, "Command failed"))) {
        renderCommandEventRowId(id, author, body);
        return;
    }

    const theme = transcriptBubbleTheme(role);
    const bubble_height = transcriptBubbleHeight(author, body, image);
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = TRANSCRIPT_BUBBLE_ROUNDING });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ TRANSCRIPT_BUBBLE_PADDING_X, TRANSCRIPT_BUBBLE_PADDING_Y } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = theme.background });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = theme.border });
    _ = zgui.beginChildId(id, .{
        .w = 0.0,
        .h = bubble_height,
        .child_flags = .{ .border = true },
        .window_flags = .{
            .no_scrollbar = true,
            .no_scroll_with_mouse = true,
            .no_saved_settings = true,
        },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    zgui.textColored(theme.author, "{s}", .{author});
    zgui.dummy(.{ .w = 0.0, .h = 2.0 });
    if (image) |attachment| {
        renderImageAttachmentCard(state, attachment, false);
        if (body.len > 0) {
            zgui.dummy(.{ .w = 0.0, .h = 8.0 });
        }
    }
    zgui.pushTextWrapPos(0.0);
    zgui.textWrapped("{s}", .{body});
    zgui.popTextWrapPos();
}

fn renderTranscriptBubble(state: *AppState, id: [:0]const u8, role: ChatRole, author: []const u8, body: []const u8, image: ?ChatImageAttachment, muted_body: bool) void {
    const theme = transcriptBubbleTheme(role);
    const bubble_height = transcriptBubbleHeight(author, body, image);
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = TRANSCRIPT_BUBBLE_ROUNDING });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ TRANSCRIPT_BUBBLE_PADDING_X, TRANSCRIPT_BUBBLE_PADDING_Y } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = theme.background });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = theme.border });
    _ = zgui.beginChild(id, .{
        .w = 0.0,
        .h = bubble_height,
        .child_flags = .{ .border = true },
        .window_flags = .{
            .no_scrollbar = true,
            .no_scroll_with_mouse = true,
            .no_saved_settings = true,
        },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    zgui.textColored(theme.author, "{s}", .{author});
    zgui.dummy(.{ .w = 0.0, .h = 2.0 });
    if (image) |attachment| {
        renderImageAttachmentCard(state, attachment, false);
        if (body.len > 0) {
            zgui.dummy(.{ .w = 0.0, .h = 8.0 });
        }
    }
    zgui.pushTextWrapPos(0.0);
    if (muted_body) {
        zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{body});
    } else {
        zgui.textWrapped("{s}", .{body});
    }
    zgui.popTextWrapPos();
}

fn renderCommandEventRowId(id: u32, author: []const u8, body: []const u8) void {
    const row_height: f32 = 38.0;
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 10.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 14.0, 9.0 } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(28, 29, 34, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(46, 48, 56, 255) });
    _ = zgui.beginChildId(id, .{
        .w = 0.0,
        .h = row_height,
        .child_flags = .{ .border = true },
        .window_flags = .{
            .no_scrollbar = true,
            .no_scroll_with_mouse = true,
            .no_saved_settings = true,
        },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    zgui.textColored(COLOR_TEXT_MUTED, ">_", .{});
    zgui.sameLine(.{ .spacing = 12.0 });
    zgui.textColored(if (std.mem.eql(u8, author, "Command failed")) COLOR_DIFF_REMOVE else COLOR_TEXT_MUTED, "{s}", .{author});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "-", .{});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.pushTextWrapPos(0.0);
    zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{body});
    zgui.popTextWrapPos();
}

fn renderChangedFilesCardId(id: u32, body: []const u8) void {
    var entries = parseChangedFileEntries(body);
    const totals = summarizeChangedFiles(entries);
    const has_patch_details = changedFilesEntriesHavePatch(entries.items);
    const card_height = if (has_patch_details) detailedChangedFilesCardHeight(entries.items) else changedFilesCardHeight(entries.items.len);
    var open_all = false;
    var close_all = false;

    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 12.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 14.0, 10.0 } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(32, 33, 38, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(58, 60, 68, 255) });
    _ = zgui.beginChildId(id, .{
        .w = 0.0,
        .h = card_height,
        .child_flags = .{ .border = true },
        .window_flags = .{
            .no_saved_settings = true,
        },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });
        entries.deinit(std.heap.page_allocator);
    }

    renderChangedFilesHeader(entries.items.len, totals.additions, totals.deletions);
    zgui.sameLine(.{ .spacing = 12.0 });
    if (has_patch_details) {
        if (renderChangedFilesAction("Collapse all")) {
            close_all = true;
        }
        zgui.sameLine(.{ .spacing = 8.0 });
        if (renderChangedFilesAction("View diff")) {
            open_all = true;
        }
    } else {
        _ = renderChangedFilesAction("Collapse all");
        zgui.sameLine(.{ .spacing = 8.0 });
        _ = renderChangedFilesAction("View diff");
    }
    zgui.dummy(.{ .w = 0.0, .h = 4.0 });

    if (has_patch_details) {
        for (entries.items, 0..) |entry, index| {
            renderChangedFilesDetailedEntry(entry, id, index, open_all, close_all);
        }
        return;
    }

    var last_parent: ?[]const u8 = null;
    for (entries.items) |entry| {
        const parent = std.fs.path.dirname(entry.path) orelse ".";
        if (last_parent == null or !std.mem.eql(u8, last_parent.?, parent)) {
            renderChangedFilesFolder(parent);
            last_parent = parent;
        }
        renderChangedFilesEntry(entry);
    }
}

fn renderChangedFilesHeader(file_count: usize, additions: i64, deletions: i64) void {
    zgui.textColored(COLOR_TEXT_SUBTLE, "CHANGED FILES ({d})", .{file_count});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "•", .{});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_DIFF_ADD, "+{d}", .{additions});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "/", .{});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_DIFF_REMOVE, "-{d}", .{deletions});
}

fn renderChangedFilesAction(label: [:0]const u8) bool {
    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 8.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 10.0, 4.0 } });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = rgba(52, 54, 60, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = rgba(62, 64, 72, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = rgba(68, 70, 78, 255) });
    defer {
        zgui.popStyleColor(.{ .count = 3 });
        zgui.popStyleVar(.{ .count = 2 });
    }
    return zgui.button(label, .{ .h = 26.0 });
}

fn renderChangedFilesFolder(path: []const u8) void {
    zgui.textColored(COLOR_TEXT_MUTED, "v  {s}", .{path});
    zgui.dummy(.{ .w = 0.0, .h = 2.0 });
}

fn renderChangedFilesEntry(entry: ChangedFileEntry) void {
    const file_name = std.fs.path.basename(entry.path);
    zgui.textColored(COLOR_TEXT_MUTED, "    {s}", .{file_name});
    zgui.sameLine(.{ .spacing = 16.0 });
    zgui.textColored(COLOR_DIFF_ADD, "+{d}", .{entry.additions});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "/", .{});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_DIFF_REMOVE, "-{d}", .{entry.deletions});
    zgui.dummy(.{ .w = 0.0, .h = 2.0 });
}

fn renderChangedFilesDetailedEntry(
    entry: ChangedFileEntry,
    message_id: u32,
    index: usize,
    open_all: bool,
    close_all: bool,
) void {
    var header_storage: [512]u8 = undefined;
    const header_label = std.fmt.bufPrintZ(&header_storage, "{s}  +{d} / -{d}##changed-files-{d}-{d}", .{
        entry.path,
        entry.additions,
        entry.deletions,
        message_id,
        index,
    }) catch return;

    if (open_all) {
        zgui.setNextItemOpen(.{ .is_open = true, .cond = .always });
    } else if (close_all) {
        zgui.setNextItemOpen(.{ .is_open = false, .cond = .always });
    }

    if (zgui.collapsingHeader(header_label, .{})) {
        if (entry.patch) |patch| {
            renderPendingDiffPatch(patch, @as(usize, message_id) * 1000 + index);
        } else {
            zgui.textColored(COLOR_TEXT_SUBTLE, "No patch body available.", .{});
        }
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    }
}

fn renderPendingDiffFile(file: *PendingDiffFile, index: usize) void {
    const toggle_label = if (file.expanded) "v" else ">";
    const file_name = std.fs.path.basename(file.path);
    var toggle_storage: [48]u8 = undefined;
    const toggle_button_label = std.fmt.bufPrintZ(&toggle_storage, "{s}##pending-diff-toggle-{d}", .{ toggle_label, index }) catch return;

    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 8.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 8.0, 6.0 } });
    defer zgui.popStyleVar(.{ .count = 2 });

    if (zgui.button(toggle_button_label, .{ .w = 28.0, .h = 28.0 })) {
        file.expanded = !file.expanded;
    }
    zgui.sameLine(.{ .spacing = 10.0 });
    zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{file_name});
    zgui.sameLine(.{ .spacing = 10.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{file.path});
    zgui.sameLine(.{ .spacing = 12.0 });
    zgui.textColored(COLOR_DIFF_ADD, "+{d}", .{file.additions});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_TEXT_SUBTLE, "/", .{});
    zgui.sameLine(.{ .spacing = 8.0 });
    zgui.textColored(COLOR_DIFF_REMOVE, "-{d}", .{file.deletions});

    if (file.expanded) {
        if (file.patch) |patch| {
            renderPendingDiffPatch(patch, index);
        } else {
            zgui.dummy(.{ .w = 0.0, .h = 6.0 });
            zgui.textColored(COLOR_TEXT_SUBTLE, "No patch body available yet.", .{});
        }
    }

    zgui.dummy(.{ .w = 0.0, .h = 8.0 });
}

fn renderPendingDiffPatch(patch: []const u8, index: usize) void {
    const patch_height = pendingDiffPatchHeight(patch);

    zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 10.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 10.0, 10.0 } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(24, 24, 24, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(52, 52, 52, 255) });
    _ = zgui.beginChildId(@intCast(80_000 + index), .{
        .w = 0.0,
        .h = patch_height,
        .child_flags = .{ .border = true },
        .window_flags = .{
            .no_saved_settings = true,
        },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    var lines = std.mem.tokenizeScalar(u8, patch, '\n');
    while (lines.next()) |line| {
        if (line.len == 0) {
            zgui.textColored(COLOR_TEXT_SUBTLE, " ", .{});
            continue;
        }

        const color = switch (line[0]) {
            '+' => if (std.mem.startsWith(u8, line, "+++")) COLOR_TEXT_SUBTLE else COLOR_DIFF_ADD,
            '-' => if (std.mem.startsWith(u8, line, "---")) COLOR_TEXT_SUBTLE else COLOR_DIFF_REMOVE,
            '@' => COLOR_YELLOW,
            else => COLOR_TEXT_MUTED,
        };
        zgui.textColored(color, "{s}", .{line});
    }
}

fn changedFilesCardHeight(file_count: usize) f32 {
    // Header row + tight file list, no extra padding
    return 52.0 + (@as(f32, @floatFromInt(file_count)) * 26.0);
}

fn detailedChangedFilesCardHeight(entries: []const ChangedFileEntry) f32 {
    // Compact: just header + file rows. Collapsing headers expand on click.
    return 52.0 + (@as(f32, @floatFromInt(entries.len)) * 28.0);
}

fn pendingDiffCardHeight(files: []const PendingDiffFile) f32 {
    var height: f32 = 52.0; // header row
    for (files) |file| {
        height += 30.0; // file row
        if (file.expanded) {
            const patch_height = if (file.patch) |patch| pendingDiffPatchHeight(patch) else 44.0;
            height += patch_height + 8.0;
        }
    }
    return @min(height, 620.0);
}

fn pendingDiffPatchHeight(patch: []const u8) f32 {
    const line_count = countTextLines(patch);
    return @min(28.0 + (@as(f32, @floatFromInt(line_count)) * 18.0), 240.0);
}

fn parseChangedFileEntries(body: []const u8) std.ArrayListUnmanaged(ChangedFileEntry) {
    if (std.mem.startsWith(u8, body, PERSISTED_DIFF_MARKER)) {
        return parsePersistedDiffEntries(body);
    }

    var entries: std.ArrayListUnmanaged(ChangedFileEntry) = .empty;
    var lines = std.mem.tokenizeScalar(u8, body, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
        if (trimmed.len == 0) continue;

        const plus_index = std.mem.lastIndexOf(u8, trimmed, " +") orelse continue;
        const path = std.mem.trimRight(u8, trimmed[0..plus_index], &std.ascii.whitespace);
        const counts = trimmed[plus_index + 2 ..];
        const slash_index = std.mem.indexOf(u8, counts, " / -") orelse continue;
        const add_slice = counts[0..slash_index];
        const del_slice = counts[slash_index + 5 ..];
        const additions = std.fmt.parseInt(i64, add_slice, 10) catch 0;
        const deletions = std.fmt.parseInt(i64, del_slice, 10) catch 0;

        entries.append(std.heap.page_allocator, .{
            .path = path,
            .additions = additions,
            .deletions = deletions,
            .patch = null,
        }) catch break;
    }
    return entries;
}

fn parsePersistedDiffEntries(body: []const u8) std.ArrayListUnmanaged(ChangedFileEntry) {
    var entries: std.ArrayListUnmanaged(ChangedFileEntry) = .empty;
    var cursor: usize = PERSISTED_DIFF_MARKER.len;

    while (cursor < body.len) {
        const line_end_rel = std.mem.indexOfScalarPos(u8, body, cursor, '\n') orelse break;
        const header = body[cursor..line_end_rel];
        cursor = line_end_rel + 1;

        if (!std.mem.startsWith(u8, header, "FILE\t")) break;

        var parts = std.mem.splitScalar(u8, header, '\t');
        _ = parts.next();
        const path = parts.next() orelse break;
        const additions_text = parts.next() orelse break;
        const deletions_text = parts.next() orelse break;
        const patch_len_text = parts.next() orelse break;

        const additions = std.fmt.parseInt(i64, additions_text, 10) catch 0;
        const deletions = std.fmt.parseInt(i64, deletions_text, 10) catch 0;
        const patch_len = std.fmt.parseInt(usize, patch_len_text, 10) catch 0;
        if (cursor + patch_len > body.len) break;

        const patch = if (patch_len > 0) body[cursor .. cursor + patch_len] else null;
        cursor += patch_len;
        if (cursor < body.len and body[cursor] == '\n') {
            cursor += 1;
        }

        entries.append(std.heap.page_allocator, .{
            .path = path,
            .additions = additions,
            .deletions = deletions,
            .patch = patch,
        }) catch break;
    }

    return entries;
}

fn summarizeChangedFiles(entries: std.ArrayListUnmanaged(ChangedFileEntry)) struct { additions: i64, deletions: i64 } {
    var additions: i64 = 0;
    var deletions: i64 = 0;
    for (entries.items) |entry| {
        additions += entry.additions;
        deletions += entry.deletions;
    }
    return .{ .additions = additions, .deletions = deletions };
}

fn changedFilesEntriesHavePatch(entries: []const ChangedFileEntry) bool {
    for (entries) |entry| {
        if (entry.patch != null) return true;
    }
    return false;
}

fn summarizePendingDiffFiles(files: []const PendingDiffFile) struct { additions: i64, deletions: i64 } {
    var additions: i64 = 0;
    var deletions: i64 = 0;
    for (files) |file| {
        additions += file.additions;
        deletions += file.deletions;
    }
    return .{ .additions = additions, .deletions = deletions };
}

fn countTextLines(text: []const u8) usize {
    if (text.len == 0) return 1;
    var count: usize = 1;
    for (text) |char| {
        if (char == '\n') count += 1;
    }
    return count;
}

fn pendingTimelineEventsContainAssistant(events: []const PendingTimelineEvent) bool {
    for (events) |event| {
        if (event.role == .assistant and std.mem.trim(u8, event.body, &std.ascii.whitespace).len > 0) {
            return true;
        }
    }
    return false;
}

fn transcriptBubbleHeight(author: []const u8, body: []const u8, image: ?ChatImageAttachment) f32 {
    const style = zgui.getStyle();
    const avail = zgui.getContentRegionAvail();
    const inner_width = @max(avail[0] - (TRANSCRIPT_BUBBLE_PADDING_X * 2.0), 64.0);
    const author_size = zgui.calcTextSize(author, .{});
    const body_size = zgui.calcTextSize(body, .{ .wrap_width = inner_width });
    const image_height: f32 = if (image != null) clampf(inner_width * 0.46, scaledUi(132.0), scaledUi(220.0)) else 0.0;
    const image_gap: f32 = if (image != null and body.len > 0) scaledUi(8.0) else 0.0;
    const vertical_padding = TRANSCRIPT_BUBBLE_PADDING_Y * 2.0;
    const text_gap = 2.0 + style.item_spacing[1];
    const border_allowance = 4.0;
    return @max(author_size[1] + body_size[1] + image_height + image_gap + vertical_padding + text_gap + border_allowance, scaledUi(56.0));
}

fn renderComposerAttachmentPreview(state: *AppState, image: ChatImageAttachment) void {
    zgui.beginGroup();
    defer zgui.endGroup();

    renderImageAttachmentCard(state, image, true);
    zgui.sameLine(.{ .spacing = scaledUi(8.0) });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = rgba(52, 54, 61, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = rgba(74, 76, 84, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = rgba(92, 94, 102, 255) });
    if (zgui.button("x", .{ .w = scaledUi(26.0), .h = scaledUi(26.0) })) {
        state.clearCurrentDraftImage();
    }
    zgui.popStyleColor(.{ .count = 3 });
}

fn renderImageAttachmentCard(state: *AppState, image: ChatImageAttachment, compact: bool) void {
    const avail_width = @max(zgui.getContentRegionAvail()[0], scaledUi(120.0));
    const card_width: f32 = if (compact)
        clampf(avail_width, scaledUi(196.0), scaledUi(320.0))
    else
        clampf(avail_width, scaledUi(220.0), scaledUi(420.0));
    const card_height: f32 = if (compact)
        clampf(card_width * 0.34, scaledUi(68.0), scaledUi(96.0))
    else
        clampf(card_width * 0.74, scaledUi(168.0), scaledUi(260.0));
    const card_padding: f32 = if (compact) scaledUi(8.0) else scaledUi(10.0);
    const preview_width: f32 = if (compact) clampf(card_width * 0.26, scaledUi(50.0), scaledUi(72.0)) else card_width - (card_padding * 2.0);
    const preview_height: f32 = if (compact) card_height - (card_padding * 2.0) else clampf(card_height * 0.62, scaledUi(116.0), scaledUi(180.0));
    const start = zgui.getCursorScreenPos();
    var byte_size_buf = std.mem.zeroes([32:0]u8);
    const byte_size_text = formatByteSize(&byte_size_buf, image.byte_size);

    zgui.dummy(.{ .w = card_width, .h = card_height });
    const draw_list = zgui.getWindowDrawList();
    draw_list.addRectFilled(.{
        .pmin = start,
        .pmax = .{ start[0] + card_width, start[1] + card_height },
        .col = zgui.colorConvertFloat4ToU32(rgba(42, 43, 50, 255)),
        .rounding = scaledUi(12.0),
    });
    draw_list.addRect(.{
        .pmin = start,
        .pmax = .{ start[0] + card_width, start[1] + card_height },
        .col = zgui.colorConvertFloat4ToU32(rgba(68, 71, 82, 255)),
        .rounding = scaledUi(12.0),
        .thickness = 1.0,
    });
    draw_list.addRectFilled(.{
        .pmin = .{ start[0] + card_padding, start[1] + card_padding },
        .pmax = .{ start[0] + card_padding + preview_width, start[1] + card_padding + preview_height },
        .col = zgui.colorConvertFloat4ToU32(rgba(24, 25, 31, 255)),
        .rounding = scaledUi(10.0),
    });

    zgui.pushStrIdZ(image.path);
    defer zgui.popId();

    zgui.setCursorScreenPos(.{ start[0] + card_padding, start[1] + card_padding });
    const texture = state.ensureImageTexture(image.path);
    if (texture) |cached| {
        const dims = scaledImageSize(cached.width, cached.height, preview_width, preview_height);
        const x_offset = (preview_width - dims[0]) * 0.5;
        const y_offset = (preview_height - dims[1]) * 0.5;
        const image_pos = [2]f32{ start[0] + card_padding + x_offset, start[1] + card_padding + y_offset };
        zgui.setCursorScreenPos(image_pos);
        zgui.image(textureRefFromGlId(cached.texture_id), .{
            .w = dims[0],
            .h = dims[1],
        });
        zgui.setCursorScreenPos(image_pos);
        if (zgui.invisibleButton("##attachment-thumb", .{
            .w = dims[0],
            .h = dims[1],
        })) {
            state.openImageModal(image.path);
        }
        if (zgui.isItemHovered(.{})) {
            draw_list.addRect(.{
                .pmin = .{ image_pos[0], image_pos[1] },
                .pmax = .{ image_pos[0] + dims[0], image_pos[1] + dims[1] },
                .col = zgui.colorConvertFloat4ToU32(rgba(120, 124, 136, 180)),
                .rounding = scaledUi(8.0),
                .thickness = 1.0,
            });
        }
    } else {
        if (zgui.button("Image", .{ .w = preview_width, .h = preview_height })) {
            state.openImageModal(image.path);
        }
    }

    if (compact) {
        zgui.setCursorScreenPos(.{ start[0] + card_padding + preview_width + scaledUi(10.0), start[1] + scaledUi(11.0) });
        zgui.textColored(COLOR_WHITE, "{s}", .{image.file_name});
        zgui.textColored(COLOR_TEXT_MUTED, "{s}  {s}", .{ image.mime, byte_size_text });
        zgui.textColored(COLOR_TEXT_SUBTLE, "Clipboard image", .{});
    } else {
        zgui.setCursorScreenPos(.{ start[0] + scaledUi(12.0), start[1] + card_padding + preview_height + scaledUi(10.0) });
        zgui.textColored(COLOR_WHITE, "{s}", .{image.file_name});
        zgui.textColored(COLOR_TEXT_MUTED, "{s}  {s}", .{ image.mime, byte_size_text });
    }
    zgui.setCursorScreenPos(.{ start[0], start[1] + card_height });
}

fn scaledImageSize(width: i32, height: i32, max_width: f32, max_height: f32) [2]f32 {
    if (width <= 0 or height <= 0) return .{ max_width, max_height };
    const width_f: f32 = @floatFromInt(width);
    const height_f: f32 = @floatFromInt(height);
    const scale = @min(max_width / width_f, max_height / height_f);
    return .{ width_f * scale, height_f * scale };
}

fn textureRefFromGlId(texture_id: c_uint) zgui.TextureRef {
    return .{
        .tex_data = null,
        .tex_id = @enumFromInt(@as(u64, texture_id)),
    };
}

fn formatByteSize(buffer: *[32:0]u8, size: usize) [:0]const u8 {
    @memset(buffer, 0);
    if (size >= 1024 * 1024) {
        _ = std.fmt.bufPrintZ(buffer, "{d:.1} MB", .{@as(f64, @floatFromInt(size)) / (1024.0 * 1024.0)}) catch {};
    } else if (size >= 1024) {
        _ = std.fmt.bufPrintZ(buffer, "{d:.1} KB", .{@as(f64, @floatFromInt(size)) / 1024.0}) catch {};
    } else {
        _ = std.fmt.bufPrintZ(buffer, "{d} B", .{size}) catch {};
    }
    return std.mem.sliceTo(buffer, 0);
}

const TranscriptBubbleTheme = struct {
    background: [4]f32,
    border: [4]f32,
    author: [4]f32,
};

fn transcriptBubbleTheme(role: ChatRole) TranscriptBubbleTheme {
    return switch (role) {
        .user => .{
            .background = rgba(18, 62, 42, 255),
            .border = rgba(28, 140, 80, 180),
            .author = rgba(130, 255, 180, 255),
        },
        .assistant => .{
            .background = rgba(38, 39, 44, 255),
            .border = rgba(62, 64, 72, 255),
            .author = rgba(180, 185, 200, 255),
        },
        .system => .{
            .background = rgba(52, 42, 18, 255),
            .border = rgba(140, 112, 28, 180),
            .author = rgba(255, 230, 150, 255),
        },
    };
}

fn transcriptShouldAutoFollow(state: *AppState) bool {
    if (!isSendPending(state)) return false;
    const scroll_max_y = zgui.getScrollMaxY();
    if (scroll_max_y <= 0.0) return true;
    const scroll_y = zgui.getScrollY();
    return (scroll_max_y - scroll_y) <= scaledUi(72.0);
}

fn renderComposer(state: *AppState, width: f32, height: f32) void {
    const composer_bg = rgba(30, 31, 36, 255);
    const composer_rounding = scaledUi(18.0);
    state.composer_focused = false;
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = composer_rounding });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ scaledUi(18.0), scaledUi(14.0) } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = composer_bg });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = .{ 0, 0, 0, 0 } }); // hide default border
    const composer_screen_pos = zgui.getCursorScreenPos();
    _ = zgui.beginChild("Composer", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
    });
    defer {
        // Draw custom border: green when focused, default when not
        const focused = zgui.isWindowFocused(.{ .child_windows = true });
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 2 });

        const border_color = if (focused)
            rgba(124, 221, 94, 140)
        else
            rgba(58, 62, 78, 255);
        const draw_list = zgui.getWindowDrawList();
        draw_list.addRect(.{
            .pmin = composer_screen_pos,
            .pmax = .{ composer_screen_pos[0] + width, composer_screen_pos[1] + height },
            .col = zgui.colorConvertFloat4ToU32(border_color),
            .rounding = composer_rounding,
            .thickness = 1.5,
        });
    }

    // --- Text input (frameless, blends with container) ---
    if (state.currentThread().draft_image) |image| {
        renderComposerAttachmentPreview(state, image);
        zgui.dummy(.{ .w = 0.0, .h = scaledUi(10.0) });
    }

    const attachment_height: f32 = if (state.currentThread().draft_image != null) scaledUi(82.0) else 0.0;
    const content_width = @max(zgui.getContentRegionAvail()[0], scaledUi(120.0));
    const input_h: f32 = @max(height - scaledUi(86.0) - attachment_height, scaledUi(48.0));
    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 0.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ scaledUi(4.0), scaledUi(6.0) } });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg, .c = composer_bg });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_hovered, .c = composer_bg });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_active, .c = composer_bg });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = .{ 0, 0, 0, 0 } });

    const cursor_before = zgui.getCursorScreenPos();
    const buf = state.draftBuffer();
    const submitted = zgui.inputTextMultiline("##chat-draft", .{
        .buf = buf,
        .w = content_width,
        .h = input_h,
        .flags = .{
            .ctrl_enter_for_new_line = true,
            .enter_returns_true = true,
        },
    });
    state.composer_focused = zgui.isItemFocused();
    zgui.popStyleColor(.{ .count = 4 });
    zgui.popStyleVar(.{ .count = 2 });

    // Draw placeholder hint when buffer is empty (foreground so it renders above the input child window)
    if (buf[0] == 0) {
        const hint_pos = .{ cursor_before[0] + scaledUi(4.0), cursor_before[1] + scaledUi(6.0) };
        const fg_draw_list = zgui.getForegroundDrawList();
        fg_draw_list.addText(hint_pos, zgui.colorConvertFloat4ToU32(rgba(100, 102, 115, 255)), "Ask anything, or use / to show available commands", .{});
    }

    // --- Bottom toolbar row ---
    zgui.dummy(.{ .w = 0.0, .h = scaledUi(2.0) });
    renderComposerPickers(state);

    // Send button on the right side of the same row
    const send_btn_size = scaledUi(32.0);
    zgui.sameLine(.{ .spacing = 0.0 });
    const avail = zgui.getContentRegionAvail();
    if (avail[0] > send_btn_size + scaledUi(4.0)) {
        zgui.sameLine(.{ .spacing = avail[0] - send_btn_size - scaledUi(4.0) });
    }

    {
        const pending = isSendPending(state);
        const btn_pos = zgui.getCursorScreenPos();
        const clicked = zgui.invisibleButton("##send-btn", .{ .w = send_btn_size, .h = send_btn_size });
        const hovered = zgui.isItemHovered(.{});
        const draw_list = zgui.getWindowDrawList();
        const cx = btn_pos[0] + send_btn_size * 0.5;
        const cy = btn_pos[1] + send_btn_size * 0.5;
        const r = send_btn_size * 0.5;

        // Circle background
        const circle_color = if (pending)
            rgba(80, 72, 24, 255)
        else if (hovered)
            lighten(COLOR_GREEN, 0.12)
        else
            COLOR_GREEN;
        draw_list.addCircleFilled(.{
            .p = .{ cx, cy },
            .r = r,
            .col = zgui.colorConvertFloat4ToU32(circle_color),
        });

        if (pending) {
            // Three dots for pending state
            const dot_r = scaledUi(2.0);
            const white = zgui.colorConvertFloat4ToU32(COLOR_WHITE);
            draw_list.addCircleFilled(.{ .p = .{ cx - scaledUi(6.0), cy }, .r = dot_r, .col = white });
            draw_list.addCircleFilled(.{ .p = .{ cx, cy }, .r = dot_r, .col = white });
            draw_list.addCircleFilled(.{ .p = .{ cx + scaledUi(6.0), cy }, .r = dot_r, .col = white });
        } else {
            // Arrow icon: triangle head + line shaft
            const white = zgui.colorConvertFloat4ToU32(COLOR_WHITE);
            const arrow_half_w = scaledUi(5.5);
            const arrow_top = cy - scaledUi(7.0);
            const arrow_mid = cy - scaledUi(1.0);
            const arrow_bottom = cy + scaledUi(7.0);

            // Arrowhead (triangle pointing up)
            draw_list.addTriangleFilled(.{
                .p1 = .{ cx, arrow_top },
                .p2 = .{ cx - arrow_half_w, arrow_mid },
                .p3 = .{ cx + arrow_half_w, arrow_mid },
                .col = white,
            });
            // Shaft (thick line)
            draw_list.addLine(.{
                .p1 = .{ cx, arrow_mid },
                .p2 = .{ cx, arrow_bottom },
                .col = white,
                .thickness = scaledUi(2.4),
            });
        }

        if ((clicked or submitted) and !pending) {
            state.sendDraft() catch |err| {
                log.err("failed to send draft: {s}", .{@errorName(err)});
            };
        }
    }
}

fn renderComposerPickers(state: *AppState) void {
    const thread = state.currentThreadMutable();

    // Subtle combo styling — transparent background, no visual frame
    const transparent = rgba(0, 0, 0, 0);
    const picker_text_color = rgba(160, 164, 180, 255);
    const picker_hover_bg = rgba(50, 52, 60, 255);
    const separator_color = rgba(60, 62, 72, 255);

    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 8.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 8.0, 6.0 } });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg, .c = transparent });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_hovered, .c = picker_hover_bg });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_active, .c = picker_hover_bg });
    zgui.pushStyleColor4f(.{ .idx = .popup_bg, .c = rgba(26, 27, 32, 250) });
    zgui.pushStyleColor4f(.{ .idx = .header, .c = rgba(42, 44, 52, 255) });
    zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = rgba(52, 54, 64, 255) });
    zgui.pushStyleColor4f(.{ .idx = .header_active, .c = rgba(58, 60, 70, 255) });
    zgui.pushStyleColor4f(.{ .idx = .text, .c = picker_text_color });
    defer {
        zgui.popStyleColor(.{ .count = 8 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    // --- Model picker (combines provider context) ---
    const model_preview = selectedModelLabel(thread);
    var model_preview_buf = std.mem.zeroes([80:0]u8);
    const model_label = std.fmt.bufPrintZ(&model_preview_buf, "{s} v", .{model_preview}) catch "Model v";
    zgui.setNextItemWidth(composerPickerTextWidth(model_preview) + 36.0);
    if (zgui.beginCombo("##model-picker", .{
        .preview_value = model_label,
        .flags = .{ .no_arrow_button = true },
    })) {
        defer zgui.endCombo();
        // Provider sub-section
        zgui.pushStyleColor4f(.{ .idx = .text, .c = COLOR_TEXT_SUBTLE });
        zgui.textUnformatted("Provider");
        zgui.popStyleColor(.{ .count = 1 });
        inline for (@typeInfo(Provider).@"enum".fields) |field| {
            const candidate: Provider = @enumFromInt(field.value);
            var row_buf = std.mem.zeroes([48:0]u8);
            const row_label = comboRowLabel(&row_buf, providerLabel(candidate), candidate == thread.provider);
            if (zgui.selectable(row_label, .{ .selected = candidate == thread.provider, .h = 28.0 })) {
                if (thread.provider != candidate) {
                    thread.provider = candidate;
                    if (thread.provider_thread_id) |thread_id| {
                        state.allocator.free(thread_id);
                    }
                    thread.provider_thread_id = null;
                    if (thread.model_ref) |model_ref| {
                        state.allocator.free(model_ref);
                    }
                    thread.model_ref = null;
                    thread.reasoning_effort = null;
                    thread.fast_mode = .off;
                    state.markDirty();
                }
            }
        }
        zgui.separator();
        // Model sub-section
        zgui.pushStyleColor4f(.{ .idx = .text, .c = COLOR_TEXT_SUBTLE });
        zgui.textUnformatted("Model");
        zgui.popStyleColor(.{ .count = 1 });
        for (modelOptions(thread.provider)) |option| {
            const is_selected = if (option.value) |value|
                thread.model_ref != null and std.mem.eql(u8, thread.model_ref.?, value)
            else
                thread.model_ref == null;
            var row_buf = std.mem.zeroes([96:0]u8);
            const row_label = comboRowLabel(&row_buf, option.label, is_selected);
            if (zgui.selectable(row_label, .{ .selected = is_selected, .h = 28.0 })) {
                setThreadModelRef(state, thread, option.value);
            }
        }
    }

    if (thread.provider == .codex) {
        // --- Separator ---
        zgui.sameLine(.{ .spacing = 6.0 });
        zgui.textColored(separator_color, "|", .{});

        // --- Reasoning effort picker ---
        zgui.sameLine(.{ .spacing = 6.0 });
        const reasoning_preview = selectedReasoningLabel(thread);
        var reasoning_buf = std.mem.zeroes([80:0]u8);
        const reasoning_label = std.fmt.bufPrintZ(&reasoning_buf, "{s} v", .{reasoning_preview}) catch "Reasoning v";
        zgui.setNextItemWidth(composerPickerTextWidth(reasoning_preview) + 36.0);
        if (zgui.beginCombo("##reasoning-picker", .{
            .preview_value = reasoning_label,
            .flags = .{ .no_arrow_button = true },
        })) {
            defer zgui.endCombo();
            for (CODEX_REASONING_OPTIONS) |option| {
                const is_selected = if (option.value) |value|
                    thread.reasoning_effort != null and thread.reasoning_effort.? == value
                else
                    thread.reasoning_effort == null;
                var row_buf = std.mem.zeroes([96:0]u8);
                const row_label = comboRowLabel(&row_buf, option.label, is_selected);
                if (zgui.selectable(row_label, .{ .selected = is_selected, .h = 28.0 })) {
                    thread.reasoning_effort = option.value;
                    state.markDirty();
                }
            }
        }

        // --- Separator ---
        zgui.sameLine(.{ .spacing = 6.0 });
        zgui.textColored(separator_color, "|", .{});

        // --- Fast mode toggle (click to switch) ---
        zgui.sameLine(.{ .spacing = 6.0 });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = transparent });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = picker_hover_bg });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = picker_hover_bg });
        const fast_label: [:0]const u8 = if (thread.fast_mode == .on) "Fast" else "Chat";
        if (zgui.button(fast_label, .{ .w = 0.0, .h = 0.0 })) {
            thread.fast_mode = if (thread.fast_mode == .on) .off else .on;
            state.markDirty();
        }
        zgui.popStyleColor(.{ .count = 3 });

        // --- Separator ---
        zgui.sameLine(.{ .spacing = 6.0 });
        zgui.textColored(separator_color, "|", .{});

        // --- Access mode toggle (click to switch) ---
        zgui.sameLine(.{ .spacing = 6.0 });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = transparent });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = picker_hover_bg });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = picker_hover_bg });
        const access_label: [:0]const u8 = accessModeLabel(thread.access_mode);
        if (zgui.button(access_label, .{ .w = 0.0, .h = 0.0 })) {
            const new_mode: AccessMode = if (thread.access_mode == .full_access) .supervised else .full_access;
            if (thread.access_mode != new_mode) {
                thread.access_mode = new_mode;
                if (thread.provider_thread_id) |thread_id| {
                    state.allocator.free(thread_id);
                }
                thread.provider_thread_id = null;
                state.markDirty();
            }
        }
        zgui.popStyleColor(.{ .count = 3 });
    }
}

fn composerPickerTextWidth(label: []const u8) f32 {
    return zgui.calcTextSize(label, .{})[0];
}

fn isSendPending(state: *AppState) bool {
    state.send_state.mutex.lock();
    defer state.send_state.mutex.unlock();
    return state.send_state.status == .pending;
}

fn setThreadModelRef(state: *AppState, thread: *ChatThread, value: ?[:0]const u8) void {
    if (thread.model_ref) |existing| {
        state.allocator.free(existing);
        thread.model_ref = null;
    }

    thread.model_ref = if (value) |next|
        state.allocator.dupeZ(u8, next) catch null
    else
        null;
    state.markDirty();
}

fn modelOptions(provider: Provider) []const ModelOption {
    return switch (provider) {
        .opencode => OPENCODE_MODEL_OPTIONS[0..],
        .codex => CODEX_MODEL_OPTIONS[0..],
    };
}

fn selectedModelLabel(thread: *const ChatThread) [:0]const u8 {
    if (thread.model_ref) |model_ref| {
        for (modelOptions(thread.provider)) |option| {
            if (option.value) |value| {
                if (std.mem.eql(u8, model_ref, value)) return option.label;
            }
        }
    }
    return "Default";
}

fn selectedReasoningLabel(thread: *const ChatThread) [:0]const u8 {
    if (thread.reasoning_effort) |effort| {
        for (CODEX_REASONING_OPTIONS) |option| {
            if (option.value) |value| {
                if (value == effort) return option.label;
            }
        }
    }
    return "Reasoning";
}

fn fastModeLabel(mode: FastMode) [:0]const u8 {
    return switch (mode) {
        .off => "Fast Off",
        .on => "Fast On",
    };
}

fn accessModeLabel(mode: AccessMode) [:0]const u8 {
    return switch (mode) {
        .full_access => "Full access",
        .supervised => "Supervised",
    };
}

fn comboPreviewLabel(buffer: []u8, label: []const u8) [:0]const u8 {
    return std.fmt.bufPrintZ(buffer, "{s}  v", .{label}) catch "Select  v";
}

fn comboRowLabel(buffer: []u8, label: []const u8, selected: bool) [:0]const u8 {
    return std.fmt.bufPrintZ(buffer, "{s} {s}", .{ if (selected) ">" else " ", label }) catch " row";
}

fn installFonts(font_size: f32) void {
    const font = zgui.io.addFontFromMemory(GEIST_SANS_BYTES[0..GEIST_SANS_BYTES.len], font_size);
    zgui.io.setDefaultFont(font);
    heading_font_size = font_size * 1.28;
    heading_font = zgui.io.addFontFromMemory(GEIST_SANS_BYTES[0..GEIST_SANS_BYTES.len], heading_font_size);
}

fn applyTheme(ui_scale: f32) void {
    const scale = if (std.math.isFinite(ui_scale) and ui_scale > 0.0) ui_scale else 1.0;
    const style = zgui.getStyle();
    zgui.styleColorsDark(style);

    style.font_scale_main = scale;
    style.window_rounding = 12.0 * scale;
    style.child_rounding = 12.0 * scale;
    style.frame_rounding = 10.0 * scale;
    style.grab_rounding = 10.0 * scale;
    style.window_padding = .{ 14.0 * scale, 12.0 * scale };
    style.item_spacing = .{ 10.0 * scale, 8.0 * scale };

    style.setColor(.window_bg, COLOR_BLACK);
    style.setColor(.child_bg, COLOR_PANEL);
    style.setColor(.frame_bg, COLOR_PANEL_ALT);
    style.setColor(.frame_bg_hovered, lighten(COLOR_PANEL_ALT, 0.10));
    style.setColor(.frame_bg_active, lighten(COLOR_PANEL_ALT, 0.16));
    style.setColor(.button, COLOR_GREEN);
    style.setColor(.button_hovered, lighten(COLOR_GREEN, 0.12));
    style.setColor(.button_active, darken(COLOR_GREEN, 0.08));
    style.setColor(.border, rgba(48, 50, 56, 255));
    style.setColor(.separator, rgba(48, 50, 56, 255));
    style.setColor(.check_mark, COLOR_WHITE);
    style.setColor(.text, COLOR_WHITE);
    style.setColor(.text_selected_bg, rgba(124, 221, 94, 80));
    style.setColor(.title_bg, COLOR_PANEL);
    style.setColor(.title_bg_active, COLOR_PANEL_ALT);
    style.setColor(.header, COLOR_PANEL_ALT);
    style.setColor(.header_hovered, lighten(COLOR_PANEL_ALT, 0.08));
    style.setColor(.header_active, COLOR_GREEN);
    style.setColor(.scrollbar_bg, rgba(22, 22, 26, 64));
    style.setColor(.scrollbar_grab, rgba(60, 62, 68, 200));
    style.setColor(.scrollbar_grab_hovered, rgba(80, 82, 90, 255));
    style.setColor(.scrollbar_grab_active, COLOR_GREEN);
}

fn providerLabel(provider: Provider) [:0]const u8 {
    return switch (provider) {
        .opencode => "OpenCode",
        .codex => "Codex",
    };
}

fn harnessLabel(harness: Harness) [:0]const u8 {
    return switch (harness) {
        .local_cli => "Local CLI",
        .remote_session => "Remote Session",
    };
}

fn lastMessagePreview(project: *const Project) []const u8 {
    const thread = project.currentThread();
    const message = thread.messages.items[thread.messages.items.len - 1];
    const body = message.body;
    if (body.len <= 44) return body;
    return body[0..44];
}

fn projectLabelFromPath(path: []const u8) []const u8 {
    const basename = std.fs.path.basename(path);
    return if (basename.len == 0) path else basename;
}

fn selectedCommittedThreadIndex(project: *const Project) usize {
    var committed_index: usize = 0;
    var fallback_index: usize = 0;
    for (project.threads.items, 0..) |thread, index| {
        if (!thread.committed) continue;
        if (index == project.selected_thread_index) return committed_index;
        committed_index += 1;
        fallback_index = committed_index - 1;
    }
    return if (committed_index == 0) 0 else fallback_index;
}

fn makeThreadTitle(allocator: std.mem.Allocator, prompt: []const u8) ![:0]const u8 {
    const trimmed = std.mem.trim(u8, prompt, &std.ascii.whitespace);
    if (trimmed.len == 0) return try allocator.dupeZ(u8, "New chat");

    var compact: [96]u8 = undefined;
    var count: usize = 0;
    var saw_space = false;
    for (trimmed) |char| {
        const normalized = if (std.ascii.isWhitespace(char)) ' ' else char;
        if (normalized == ' ') {
            if (count == 0 or saw_space) continue;
            saw_space = true;
        } else {
            saw_space = false;
        }
        if (count == compact.len) break;
        compact[count] = normalized;
        count += 1;
    }

    while (count > 0 and compact[count - 1] == ' ') {
        count -= 1;
    }
    if (count == 0) return try allocator.dupeZ(u8, "New chat");
    return try allocator.dupeZ(u8, compact[0..count]);
}

fn compactComparisonText(buffer: []u8, value: []const u8) []const u8 {
    const trimmed = std.mem.trim(u8, value, &std.ascii.whitespace);
    if (trimmed.len == 0 or buffer.len == 0) return "";

    var count: usize = 0;
    var saw_space = false;
    for (trimmed) |char| {
        const normalized = if (std.ascii.isWhitespace(char)) ' ' else std.ascii.toLower(char);
        if (normalized == ' ') {
            if (count == 0 or saw_space) continue;
            saw_space = true;
        } else {
            saw_space = false;
        }
        if (count == buffer.len) break;
        buffer[count] = normalized;
        count += 1;
    }

    while (count > 0 and buffer[count - 1] == ' ') {
        count -= 1;
    }
    return buffer[0..count];
}

fn formatThreadPreview(buffer: *[72:0]u8, thread: *const ChatThread) [:0]const u8 {
    if (thread.messages.items.len == 0) return "Awaiting first prompt";
    const body = thread.messages.items[0].body;
    const max_len = @min(buffer.len - 1, @as(usize, 34));
    const source = std.mem.trim(u8, body, &std.ascii.whitespace);
    const title = std.mem.trim(u8, thread.title, &std.ascii.whitespace);
    var normalized_source_buf = std.mem.zeroes([96]u8);
    var normalized_title_buf = std.mem.zeroes([96]u8);
    const normalized_source = compactComparisonText(&normalized_source_buf, source);
    const normalized_title = compactComparisonText(&normalized_title_buf, title);
    if (std.mem.eql(u8, normalized_source, normalized_title)) return "";
    if (std.mem.startsWith(u8, normalized_source, normalized_title) or std.mem.startsWith(u8, normalized_title, normalized_source)) return "";
    const shared_prefix_len = @min(@min(normalized_source.len, normalized_title.len), @as(usize, 24));
    if (shared_prefix_len >= 16 and std.mem.eql(u8, normalized_source[0..shared_prefix_len], normalized_title[0..shared_prefix_len])) {
        return "";
    }
    if (source.len <= max_len) {
        @memcpy(buffer[0..source.len], source);
        buffer[source.len] = 0;
        return buffer[0..source.len :0];
    }
    if (max_len <= 3) return "...";
    const prefix_len = max_len - 3;
    @memcpy(buffer[0..prefix_len], source[0..prefix_len]);
    @memcpy(buffer[prefix_len..max_len], "...");
    buffer[max_len] = 0;
    return buffer[0..max_len :0];
}

fn truncatedThreadTitle(buffer: *[64:0]u8, value: []const u8, max_len: usize) [:0]const u8 {
    const bounded_max = @min(buffer.len - 1, max_len);
    if (value.len <= bounded_max) return std.fmt.bufPrintZ(buffer, "{s}", .{value}) catch value[0..bounded_max :0];
    if (bounded_max <= 3) return "...";
    const prefix_len = bounded_max - 3;
    @memcpy(buffer[0..prefix_len], value[0..prefix_len]);
    @memcpy(buffer[prefix_len..bounded_max], "...");
    buffer[bounded_max] = 0;
    return buffer[0..bounded_max :0];
}

fn formatRelativeTime(buffer: []u8, timestamp: i64) []const u8 {
    if (timestamp <= 0) return "now";
    const elapsed = @max(std.time.timestamp() - timestamp, 0);
    if (elapsed < 60) return "now";
    if (elapsed < 3600) {
        const minutes = @divFloor(elapsed, 60);
        return std.fmt.bufPrint(buffer, "{d}m ago", .{minutes}) catch "recent";
    }
    if (elapsed < 86_400) {
        const hours = @divFloor(elapsed, 3600);
        return std.fmt.bufPrint(buffer, "{d}h ago", .{hours}) catch "recent";
    }
    const days = @divFloor(elapsed, 86_400);
    return std.fmt.bufPrint(buffer, "{d}d ago", .{days}) catch "recent";
}

fn collectCommittedThreadIndicesSorted(
    allocator: std.mem.Allocator,
    project: *const Project,
) !std.ArrayList(usize) {
    var indices: std.ArrayList(usize) = .empty;
    errdefer indices.deinit(allocator);

    for (project.threads.items, 0..) |thread, index| {
        if (!thread.committed) continue;
        try indices.append(allocator, index);
    }

    std.mem.sort(usize, indices.items, project, lessThanCommittedThreadIndex);
    return indices;
}

fn lessThanCommittedThreadIndex(project: *const Project, lhs: usize, rhs: usize) bool {
    const left = project.threads.items[lhs];
    const right = project.threads.items[rhs];
    if (left.last_activity_at != right.last_activity_at) {
        return left.last_activity_at > right.last_activity_at;
    }
    return lhs > rhs;
}

fn renderSidebarThreadRow(
    state: *AppState,
    project_index: usize,
    width: f32,
    thread: *const ChatThread,
    thread_index: usize,
) void {
    const project = &state.projects.items[project_index];
    const thread_selected = project.selected_thread_index == thread_index;
    const row_width = @max(width - scaledUi(42.0), scaledUi(120.0));
    var time_buf: [24]u8 = undefined;
    const relative_time = formatRelativeTime(&time_buf, thread.last_activity_at);
    const timestamp_width = zgui.calcTextSize(relative_time, .{})[0] + scaledUi(6.0);
    const title_width_chars: usize = @intFromFloat(@max((row_width - timestamp_width - scaledUi(12.0)) / @max(zgui.getFontSize() * 0.42, 6.0), 10.0));

    zgui.pushIntId(@intCast(thread_index + 1000));
    defer zgui.popId();

    if (thread_selected) {
        zgui.pushStyleColor4f(.{ .idx = .header, .c = rgba(36, 38, 44, 255) });
        zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = rgba(42, 44, 50, 255) });
        zgui.pushStyleColor4f(.{ .idx = .header_active, .c = rgba(48, 50, 56, 255) });
    }

    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ scaledUi(8.0), scaledUi(6.0) } });
    var title_buf = std.mem.zeroes([64:0]u8);
    const row_label = truncatedThreadTitle(&title_buf, thread.title, title_width_chars);
    if (zgui.selectable(row_label, .{
        .selected = thread_selected,
        .w = row_width - timestamp_width,
        .h = scaledUi(26.0),
    })) {
        state.selected_project_index = project_index;
        state.projects.items[project_index].selected_thread_index = thread_index;
        state.syncRenameBuffer();
        state.requestTranscriptScrollToBottom();
        state.markDirty();
    }
    zgui.popStyleVar(.{ .count = 1 });

    zgui.sameLine(.{ .spacing = scaledUi(8.0) });
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{relative_time});

    var preview_buf = std.mem.zeroes([72:0]u8);
    const preview = formatThreadPreview(&preview_buf, thread);
    if (preview.len > 0) {
        zgui.textColored(if (thread_selected) COLOR_TEXT_MUTED else COLOR_TEXT_SUBTLE, "{s}", .{preview});
    }

    if (thread_selected) {
        zgui.popStyleColor(.{ .count = 3 });
    }
    zgui.dummy(.{ .w = 0.0, .h = scaledUi(2.0) });
}

fn sanitizeChatRole(role: *ChatRole) void {
    const raw = @as(*u8, @ptrCast(role)).*;
    role.* = std.meta.intToEnum(ChatRole, raw) catch .user;
}

fn sanitizeProvider(provider: *Provider) void {
    const raw = @as(*u8, @ptrCast(provider)).*;
    provider.* = std.meta.intToEnum(Provider, raw) catch .opencode;
}

fn sanitizeHarness(harness: *Harness) void {
    const raw = @as(*u8, @ptrCast(harness)).*;
    harness.* = std.meta.intToEnum(Harness, raw) catch .local_cli;
}

const PickDirectoryError = std.process.Child.RunError || std.mem.Allocator.Error || error{
    UnsupportedOperatingSystem,
    FolderPickerUnavailable,
    UserCancelled,
    ChildProcessFailed,
};

fn pickDirectory(allocator: std.mem.Allocator, start_path: []const u8) PickDirectoryError![]u8 {
    return switch (@import("builtin").os.tag) {
        .macos => pickDirectoryMacOS(allocator, start_path),
        .linux, .freebsd, .netbsd, .openbsd, .dragonfly => pickDirectoryLinux(allocator, start_path),
        else => error.UnsupportedOperatingSystem,
    };
}

fn pickDirectoryMacOS(allocator: std.mem.Allocator, start_path: []const u8) PickDirectoryError![]u8 {
    if (!commandExists("osascript")) return error.FolderPickerUnavailable;

    const escaped_start_path = try escapeAppleScriptString(allocator, start_path);
    defer allocator.free(escaped_start_path);

    const script = try std.fmt.allocPrint(
        allocator,
        \\try
        \\set defaultLocation to POSIX file "{s}"
        \\return POSIX path of (choose folder with prompt "Select project folder" default location defaultLocation)
        \\on error number -128
        \\error "User cancelled" number 1
        \\end try
    ,
        .{escaped_start_path},
    );
    defer allocator.free(script);

    const result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "osascript", "-e", script },
        .max_output_bytes = 16 * 1024,
    }) catch |err| switch (err) {
        error.FileNotFound => return error.FolderPickerUnavailable,
        else => return err,
    };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    switch (result.term) {
        .Exited => |code| {
            if (code != 0) {
                if (std.mem.indexOf(u8, result.stderr, "User cancelled") != null or
                    std.mem.indexOf(u8, result.stderr, "(-128)") != null)
                {
                    return error.UserCancelled;
                }
                return error.ChildProcessFailed;
            }
        },
        else => return error.ChildProcessFailed,
    }

    const trimmed = std.mem.trim(u8, result.stdout, &std.ascii.whitespace);
    if (trimmed.len == 0) return error.UserCancelled;
    return allocator.dupe(u8, trimmed);
}

fn pickDirectoryLinux(allocator: std.mem.Allocator, start_path: []const u8) PickDirectoryError![]u8 {
    const argv = detectLinuxPicker(start_path) orelse return error.FolderPickerUnavailable;
    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = argv,
        .max_output_bytes = 16 * 1024,
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    switch (result.term) {
        .Exited => |code| {
            if (code == 1) return error.UserCancelled;
            if (code != 0) return error.ChildProcessFailed;
        },
        else => return error.ChildProcessFailed,
    }

    const trimmed = std.mem.trim(u8, result.stdout, &std.ascii.whitespace);
    if (trimmed.len == 0) return error.UserCancelled;
    return allocator.dupe(u8, trimmed);
}

fn pickerWorker(state: *PickerState, start_path: []u8) void {
    defer std.heap.page_allocator.free(start_path);

    const result = pickDirectory(std.heap.page_allocator, start_path);

    state.mutex.lock();
    defer state.mutex.unlock();

    if (result) |path| {
        state.selected_path = path;
        state.status = .selected;
    } else |err| switch (err) {
        error.UserCancelled => state.status = .cancelled,
        error.UnsupportedOperatingSystem => state.status = .unavailable,
        error.FolderPickerUnavailable => state.status = .unavailable,
        else => state.status = .failed,
    }
}

fn sendWorker(state: *SendState, request: *SendWorkerRequest) void {
    const page_alloc = std.heap.page_allocator;
    defer {
        page_alloc.free(request.project_path);
        page_alloc.free(request.prompt);
        if (request.image_path) |image_path| page_alloc.free(image_path);
        if (request.provider_thread_id) |thread_id| page_alloc.free(thread_id);
        if (request.model_ref) |model_ref| page_alloc.free(model_ref);
        page_alloc.destroy(request);
    }

    const result = runSendWorker(page_alloc, request);

    state.mutex.lock();
    defer state.mutex.unlock();

    if (result) |payload| {
        state.result = payload;
        state.error_message = null;
        state.status = .completed;
    } else |err| {
        const message = std.fmt.allocPrint(page_alloc, "Provider request failed: {s}", .{@errorName(err)}) catch null;
        state.error_message = message;
        state.result = null;
        state.status = .failed;
    }
}

fn handleSendStreamDelta(context: ?*anyopaque, delta: []const u8) void {
    const send_state: *SendState = @ptrCast(@alignCast(context orelse return));
    const page_alloc = std.heap.page_allocator;

    send_state.mutex.lock();
    defer send_state.mutex.unlock();
    if (send_state.status != .pending) return;
    send_state.partial_text.appendSlice(page_alloc, delta) catch return;
}

fn flushPendingAssistantTextLocked(send_state: *SendState, allocator: std.mem.Allocator) void {
    if (send_state.partial_text.items.len == 0) return;
    const provider = send_state.provider orelse return;
    const trimmed = std.mem.trim(u8, send_state.partial_text.items, &std.ascii.whitespace);
    if (trimmed.len == 0) {
        send_state.partial_text.clearRetainingCapacity();
        return;
    }

    const owned_author = allocator.dupe(u8, providerLabel(provider)) catch return;
    errdefer allocator.free(owned_author);
    const owned_body = allocator.dupe(u8, send_state.partial_text.items) catch return;
    errdefer allocator.free(owned_body);

    send_state.pending_events.append(allocator, .{
        .role = .assistant,
        .author = owned_author,
        .body = owned_body,
    }) catch {
        allocator.free(owned_author);
        allocator.free(owned_body);
        return;
    };

    send_state.partial_text.clearRetainingCapacity();
}

fn handleSendStreamEvent(context: ?*anyopaque, event: ai_harness.StreamEvent) void {
    const send_state: *SendState = @ptrCast(@alignCast(context orelse return));
    const page_alloc = std.heap.page_allocator;

    send_state.mutex.lock();
    defer send_state.mutex.unlock();
    if (send_state.status != .pending) return;

    switch (event) {
        .message => |message| {
            flushPendingAssistantTextLocked(send_state, page_alloc);
            if (send_state.pending_events.items.len > 0) {
                const last = send_state.pending_events.items[send_state.pending_events.items.len - 1];
                if (last.role == .system and std.mem.eql(u8, last.author, message.title) and std.mem.eql(u8, last.body, message.body)) {
                    return;
                }
            }

            const owned_author = page_alloc.dupe(u8, message.title) catch return;
            errdefer page_alloc.free(owned_author);
            const owned_body = page_alloc.dupe(u8, message.body) catch return;
            errdefer page_alloc.free(owned_body);

            send_state.pending_events.append(page_alloc, .{
                .role = .system,
                .author = owned_author,
                .body = owned_body,
            }) catch {
                page_alloc.free(owned_author);
                page_alloc.free(owned_body);
            };
        },
        .diff => |diff| {
            flushPendingAssistantTextLocked(send_state, page_alloc);
            mergePendingDiffFilesLocked(page_alloc, &send_state.pending_diff_files, diff.files);
        },
    }
}

fn handleSendApprovalRequest(context: ?*anyopaque, request: ai_harness.ApprovalRequest) ai_harness.ApprovalDecision {
    const send_state: *SendState = @ptrCast(@alignCast(context orelse return .deny));
    const page_alloc = std.heap.page_allocator;

    const owned_call_id = page_alloc.dupe(u8, request.call_id) catch return .deny;
    errdefer page_alloc.free(owned_call_id);
    const owned_title = page_alloc.dupe(u8, request.title) catch return .deny;
    errdefer page_alloc.free(owned_title);
    const owned_body = page_alloc.dupe(u8, request.body) catch return .deny;
    errdefer page_alloc.free(owned_body);

    send_state.mutex.lock();
    defer send_state.mutex.unlock();
    if (send_state.status != .pending) {
        page_alloc.free(owned_call_id);
        page_alloc.free(owned_title);
        page_alloc.free(owned_body);
        return .deny;
    }

    flushPendingAssistantTextLocked(send_state, page_alloc);
    freePendingApprovalLocked(page_alloc, &send_state.pending_approval);
    send_state.pending_approval = .{
        .call_id = owned_call_id,
        .title = owned_title,
        .body = owned_body,
    };
    send_state.approval_decision = null;

    while (send_state.status == .pending and send_state.approval_decision == null) {
        send_state.condition.wait(&send_state.mutex);
    }

    const decision = send_state.approval_decision orelse .deny;
    send_state.approval_decision = null;
    freePendingApprovalLocked(page_alloc, &send_state.pending_approval);
    return decision;
}

fn freePendingTimelineEvents(allocator: std.mem.Allocator, events: *std.ArrayListUnmanaged(PendingTimelineEvent)) void {
    for (events.items) |event| {
        allocator.free(event.author);
        allocator.free(event.body);
    }
    events.deinit(allocator);
    events.* = .empty;
}

fn freePendingTimelineEventsLocked(allocator: std.mem.Allocator, events: *std.ArrayListUnmanaged(PendingTimelineEvent)) void {
    freePendingTimelineEvents(allocator, events);
}

fn freePendingDiffFiles(allocator: std.mem.Allocator, files: *std.ArrayListUnmanaged(PendingDiffFile)) void {
    for (files.items) |file| {
        allocator.free(file.path);
        if (file.patch) |patch| allocator.free(patch);
    }
    files.deinit(allocator);
    files.* = .empty;
}

fn freePendingDiffFilesLocked(allocator: std.mem.Allocator, files: *std.ArrayListUnmanaged(PendingDiffFile)) void {
    freePendingDiffFiles(allocator, files);
}

fn mergePendingDiffFilesLocked(
    allocator: std.mem.Allocator,
    target: *std.ArrayListUnmanaged(PendingDiffFile),
    files: []const ai_harness.StreamDiffFile,
) void {
    for (files) |file| {
        if (upsertPendingDiffFileLocked(allocator, target, file)) |_| {} else |_| return;
    }
}

fn upsertPendingDiffFileLocked(
    allocator: std.mem.Allocator,
    target: *std.ArrayListUnmanaged(PendingDiffFile),
    file: ai_harness.StreamDiffFile,
) !void {
    for (target.items) |*existing| {
        if (!std.mem.eql(u8, existing.path, file.path)) continue;

        existing.additions = file.additions;
        existing.deletions = file.deletions;
        if (existing.patch) |patch| {
            allocator.free(patch);
            existing.patch = null;
        }
        if (file.patch) |patch| {
            existing.patch = try allocator.dupe(u8, patch);
        }
        return;
    }

    try target.append(allocator, .{
        .path = try allocator.dupe(u8, file.path),
        .additions = file.additions,
        .deletions = file.deletions,
        .patch = if (file.patch) |patch| try allocator.dupe(u8, patch) else null,
        .expanded = false,
    });
}

fn appendPendingDiffSummaryEvent(
    allocator: std.mem.Allocator,
    events: *std.ArrayListUnmanaged(PendingTimelineEvent),
    files: []const PendingDiffFile,
) void {
    if (files.len == 0) return;

    var body_builder: std.ArrayListUnmanaged(u8) = .empty;
    defer body_builder.deinit(allocator);

    body_builder.appendSlice(allocator, PERSISTED_DIFF_MARKER) catch return;

    for (files) |file| {
        const patch = file.patch orelse "";
        std.fmt.format(body_builder.writer(allocator), "FILE\t{s}\t{d}\t{d}\t{d}\n", .{
            file.path,
            file.additions,
            file.deletions,
            patch.len,
        }) catch return;
        body_builder.appendSlice(allocator, patch) catch return;
        body_builder.append(allocator, '\n') catch return;
    }

    const owned_title = allocator.dupe(u8, "Changed files") catch return;
    errdefer allocator.free(owned_title);
    const owned_body = body_builder.toOwnedSlice(allocator) catch {
        allocator.free(owned_title);
        return;
    };

    events.append(allocator, .{
        .role = .system,
        .author = owned_title,
        .body = owned_body,
    }) catch {
        allocator.free(owned_title);
        allocator.free(owned_body);
    };
}

fn freePendingApproval(allocator: std.mem.Allocator, approval: *?PendingApproval) void {
    if (approval.*) |pending| {
        allocator.free(pending.call_id);
        allocator.free(pending.title);
        allocator.free(pending.body);
        approval.* = null;
    }
}

fn freePendingApprovalLocked(allocator: std.mem.Allocator, approval: *?PendingApproval) void {
    freePendingApproval(allocator, approval);
}

fn approvalPolicyForMode(provider: Provider, mode: AccessMode) ?ai_harness.ApprovalPolicy {
    if (provider != .codex) return null;
    return switch (mode) {
        .full_access => .never,
        .supervised => .on_request,
    };
}

fn sandboxModeForMode(provider: Provider, mode: AccessMode) ?ai_harness.SandboxMode {
    if (provider != .codex) return null;
    return switch (mode) {
        .full_access => .danger_full_access,
        .supervised => .workspace_write,
    };
}

fn runSendWorker(
    allocator: std.mem.Allocator,
    request: *const SendWorkerRequest,
) !SendResultPayload {
    if (request.harness != .local_cli) {
        return error.UnsupportedHarnessMode;
    }

    const provider_config = switch (request.provider) {
        .opencode => ai_harness.ProviderConfig{
            .opencode = .{
                .allocator = allocator,
                .working_directory = request.project_path,
                .launch_if_missing = true,
            },
        },
        .codex => ai_harness.ProviderConfig{
            .codex = .{
                .cwd = request.project_path,
                .launch_on_connect = true,
            },
        },
    };

    var client = try ai_harness.connect(allocator, provider_config);
    defer client.deinit();

    const result = try client.sendPrompt(allocator, .{
        .thread_id = request.provider_thread_id,
        .prompt = request.prompt,
        .image = if (request.image_path) |image_path| .{ .path = image_path } else null,
        .cwd = request.project_path,
        .model = request.model_ref,
        .reasoning_effort = request.reasoning_effort,
        .approval_policy = approvalPolicyForMode(request.provider, request.access_mode),
        .sandbox_mode = sandboxModeForMode(request.provider, request.access_mode),
        .stream_context = request.send_state_ptr,
        .on_stream_delta = handleSendStreamDelta,
        .on_stream_event = handleSendStreamEvent,
        .on_approval_request = handleSendApprovalRequest,
    });

    return .{
        .project_index = request.project_index,
        .thread_index = request.thread_index,
        .provider_thread_id = result.thread_id,
        .reply_text = result.reply_text,
    };
}

fn detectLinuxPicker(start_path: []const u8) ?[]const []const u8 {
    if (commandExists("zenity")) {
        return &.{
            "zenity",
            "--file-selection",
            "--directory",
            "--filename",
            start_path,
            "--title",
            "Select project folder",
        };
    }

    if (commandExists("kdialog")) {
        return &.{
            "kdialog",
            "--getexistingdirectory",
            start_path,
            "--title",
            "Select project folder",
        };
    }

    if (commandExists("yad")) {
        return &.{
            "yad",
            "--file-selection",
            "--directory",
            "--filename",
            start_path,
            "--title",
            "Select project folder",
        };
    }

    if (commandExists("qarma")) {
        return &.{
            "qarma",
            "--file-selection",
            "--directory",
            "--filename",
            start_path,
            "--title",
            "Select project folder",
        };
    }

    return null;
}

fn escapeAppleScriptString(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var escaped: std.ArrayList(u8) = .empty;
    errdefer escaped.deinit(allocator);

    for (value) |char| {
        switch (char) {
            '\\', '"' => {
                try escaped.append(allocator, '\\');
                try escaped.append(allocator, char);
            },
            else => try escaped.append(allocator, char),
        }
    }

    return escaped.toOwnedSlice(allocator);
}

const ClipboardImageCapture = struct {
    bytes: []u8,
    mime: []const u8,
};

fn captureClipboardImage(allocator: std.mem.Allocator) !?ClipboardImageCapture {
    return switch (@import("builtin").os.tag) {
        .macos => captureClipboardImageMacOS(allocator),
        .linux, .freebsd, .netbsd, .openbsd, .dragonfly => {
            if (try captureClipboardImageWayland(allocator)) |image| return image;
            return try captureClipboardImageX11(allocator);
        },
        else => null,
    };
}

const MacClipboardImageFlavor = struct {
    class_code: []const u8,
    mime: []const u8,
};

fn captureClipboardImageMacOS(allocator: std.mem.Allocator) !?ClipboardImageCapture {
    const info_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "osascript", "-e", "clipboard info" },
        .cwd = ".",
        .max_output_bytes = 16 * 1024,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(info_result.stdout);
    defer allocator.free(info_result.stderr);

    switch (info_result.term) {
        .Exited => |code| if (code != 0) return null,
        else => return null,
    }

    const preferred = selectMacClipboardImageFlavor(info_result.stdout) orelse return null;
    var capture = try readMacClipboardImageFlavor(allocator, preferred.class_code, preferred.mime);
    if (capture == null and std.mem.eql(u8, preferred.class_code, "PNGf")) {
        capture = try readMacClipboardImageFlavor(allocator, "TIFF", "image/tiff");
    }
    if (capture == null) return null;

    if (std.mem.eql(u8, capture.?.mime, "image/tiff")) {
        return try convertClipboardTiffToPng(allocator, capture.?);
    }

    return capture;
}

fn selectMacClipboardImageFlavor(info_output: []const u8) ?MacClipboardImageFlavor {
    const candidates = [_]MacClipboardImageFlavor{
        .{ .class_code = "PNGf", .mime = "image/png" },
        .{ .class_code = "JPEG", .mime = "image/jpeg" },
        .{ .class_code = "TIFF", .mime = "image/tiff" },
    };

    for (candidates) |candidate| {
        if (std.mem.indexOf(u8, info_output, candidate.class_code) != null) {
            return candidate;
        }
    }
    if (std.mem.indexOf(u8, info_output, "TIFF picture") != null) {
        return .{ .class_code = "TIFF", .mime = "image/tiff" };
    }
    if (std.mem.indexOf(u8, info_output, "JPEG picture") != null) {
        return .{ .class_code = "JPEG", .mime = "image/jpeg" };
    }
    return null;
}

fn readMacClipboardImageFlavor(allocator: std.mem.Allocator, class_code: []const u8, mime: []const u8) !?ClipboardImageCapture {
    const command = try std.fmt.allocPrint(allocator, "get the clipboard as «class {s}»", .{class_code});
    defer allocator.free(command);

    const result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "osascript", "-e", command },
        .cwd = ".",
        .max_output_bytes = CLIPBOARD_IMAGE_MAX_BYTES * 4,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(result.stderr);

    switch (result.term) {
        .Exited => |code| if (code != 0) {
            allocator.free(result.stdout);
            return null;
        },
        else => {
            allocator.free(result.stdout);
            return null;
        },
    }

    const decoded = decodeAppleScriptClipboardData(allocator, result.stdout, class_code) catch {
        allocator.free(result.stdout);
        return null;
    };
    allocator.free(result.stdout);

    if (decoded.len == 0) {
        allocator.free(decoded);
        return null;
    }

    return .{
        .bytes = decoded,
        .mime = mime,
    };
}

fn decodeAppleScriptClipboardData(allocator: std.mem.Allocator, encoded: []const u8, class_code: []const u8) ![]u8 {
    const prefix = try std.fmt.allocPrint(allocator, "«data {s}", .{class_code});
    defer allocator.free(prefix);

    const start_index = std.mem.indexOf(u8, encoded, prefix) orelse return error.InvalidClipboardPayload;
    const payload_start = start_index + prefix.len;
    const suffix_rel = std.mem.indexOfScalar(u8, encoded[payload_start..], '»') orelse return error.InvalidClipboardPayload;
    const payload_raw = encoded[payload_start .. payload_start + suffix_rel];

    var hex_only: std.ArrayList(u8) = .empty;
    defer hex_only.deinit(allocator);

    for (payload_raw) |char| {
        if (std.ascii.isWhitespace(char)) continue;
        try hex_only.append(allocator, char);
    }

    if (hex_only.items.len == 0 or (hex_only.items.len % 2) != 0) {
        return error.InvalidClipboardPayload;
    }

    const decoded = try allocator.alloc(u8, hex_only.items.len / 2);
    errdefer allocator.free(decoded);
    _ = try std.fmt.hexToBytes(decoded, hex_only.items);
    return decoded;
}

fn convertClipboardTiffToPng(allocator: std.mem.Allocator, capture: ClipboardImageCapture) !?ClipboardImageCapture {
    defer allocator.free(capture.bytes);

    const temp_dir = std.fs.path.join(allocator, &.{ "/tmp", "editorts-native-clipboard" }) catch return error.OutOfMemory;
    defer allocator.free(temp_dir);
    try std.fs.makeDirAbsolute(temp_dir);

    const timestamp_ms = @as(u64, @intCast(@max(@as(i64, 0), std.time.milliTimestamp())));
    const input_path = try std.fmt.allocPrint(allocator, "{s}/clipboard-{d}.tiff", .{ temp_dir, timestamp_ms });
    defer allocator.free(input_path);
    const output_path = try std.fmt.allocPrint(allocator, "{s}/clipboard-{d}.png", .{ temp_dir, timestamp_ms });
    defer allocator.free(output_path);

    {
        var file = try std.fs.createFileAbsolute(input_path, .{ .truncate = true });
        defer file.close();
        try file.writeAll(capture.bytes);
    }

    const convert_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "sips", "-s", "format", "png", input_path, "--out", output_path },
        .cwd = ".",
        .max_output_bytes = 16 * 1024,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(convert_result.stdout);
    defer allocator.free(convert_result.stderr);

    switch (convert_result.term) {
        .Exited => |code| if (code != 0) return null,
        else => return null,
    }

    const png_bytes = png_bytes: {
        const png_file = try std.fs.openFileAbsolute(output_path, .{});
        defer png_file.close();
        break :png_bytes try png_file.readToEndAlloc(allocator, CLIPBOARD_IMAGE_MAX_BYTES);
    };
    std.fs.deleteFileAbsolute(input_path) catch {};
    std.fs.deleteFileAbsolute(output_path) catch {};

    return .{
        .bytes = png_bytes,
        .mime = "image/png",
    };
}

fn captureClipboardImageWayland(allocator: std.mem.Allocator) !?ClipboardImageCapture {
    const types_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "wl-paste", "--list-types" },
        .cwd = ".",
        .max_output_bytes = 16 * 1024,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(types_result.stdout);
    defer allocator.free(types_result.stderr);

    switch (types_result.term) {
        .Exited => |code| if (code != 0) return null,
        else => return null,
    }

    const mime = selectClipboardImageMime(types_result.stdout) orelse return null;
    const image_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "wl-paste", "--no-newline", "--type", mime },
        .cwd = ".",
        .max_output_bytes = CLIPBOARD_IMAGE_MAX_BYTES,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(image_result.stderr);

    switch (image_result.term) {
        .Exited => |code| if (code != 0) {
            allocator.free(image_result.stdout);
            return null;
        },
        else => {
            allocator.free(image_result.stdout);
            return null;
        },
    }

    if (image_result.stdout.len == 0) {
        allocator.free(image_result.stdout);
        return null;
    }

    return .{
        .bytes = image_result.stdout,
        .mime = mime,
    };
}

fn captureClipboardImageX11(allocator: std.mem.Allocator) !?ClipboardImageCapture {
    const targets_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "xclip", "-selection", "clipboard", "-t", "TARGETS", "-o" },
        .cwd = ".",
        .max_output_bytes = 16 * 1024,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(targets_result.stdout);
    defer allocator.free(targets_result.stderr);

    switch (targets_result.term) {
        .Exited => |code| if (code != 0) return null,
        else => return null,
    }

    const mime = selectClipboardImageMime(targets_result.stdout) orelse return null;
    const image_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "xclip", "-selection", "clipboard", "-t", mime, "-o" },
        .cwd = ".",
        .max_output_bytes = CLIPBOARD_IMAGE_MAX_BYTES,
    }) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return err,
    };
    defer allocator.free(image_result.stderr);

    switch (image_result.term) {
        .Exited => |code| if (code != 0) {
            allocator.free(image_result.stdout);
            return null;
        },
        else => {
            allocator.free(image_result.stdout);
            return null;
        },
    }

    if (image_result.stdout.len == 0) {
        allocator.free(image_result.stdout);
        return null;
    }

    return .{
        .bytes = image_result.stdout,
        .mime = mime,
    };
}

fn selectClipboardImageMime(types_output: []const u8) ?[]const u8 {
    const candidates = [_][]const u8{
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/bmp",
    };

    for (candidates) |candidate| {
        if (std.mem.indexOf(u8, types_output, candidate) != null) {
            return candidate;
        }
    }
    return null;
}

fn extensionForImageMime(mime: []const u8) []const u8 {
    if (std.mem.eql(u8, mime, "image/png")) return "png";
    if (std.mem.eql(u8, mime, "image/jpeg")) return "jpg";
    if (std.mem.eql(u8, mime, "image/webp")) return "webp";
    if (std.mem.eql(u8, mime, "image/gif")) return "gif";
    if (std.mem.eql(u8, mime, "image/bmp")) return "bmp";
    return "img";
}

fn commandExists(name: []const u8) bool {
    const path_env = std.posix.getenv("PATH") orelse return false;
    var parts = std.mem.splitScalar(u8, path_env, ':');
    while (parts.next()) |part| {
        if (part.len == 0) continue;
        const joined = std.fs.path.join(std.heap.page_allocator, &.{ part, name }) catch return false;
        defer std.heap.page_allocator.free(joined);

        const file = if (std.fs.path.isAbsolute(joined))
            std.fs.openFileAbsolute(joined, .{}) catch continue
        else
            std.fs.cwd().openFile(joined, .{}) catch continue;
        file.close();
        return true;
    }
    return false;
}

fn messageBubbleColor(role: ChatRole) [4]f32 {
    return switch (role) {
        .user => darken(COLOR_GREEN, 0.22),
        .assistant => COLOR_PANEL_ALT,
        .system => darken(COLOR_YELLOW, 0.48),
    };
}

fn rgb(r: u8, g: u8, b: u8) [4]f32 {
    return rgba(r, g, b, 255);
}

fn rgba(r: u8, g: u8, b: u8, a: u8) [4]f32 {
    return .{
        @as(f32, @floatFromInt(r)) / 255.0,
        @as(f32, @floatFromInt(g)) / 255.0,
        @as(f32, @floatFromInt(b)) / 255.0,
        @as(f32, @floatFromInt(a)) / 255.0,
    };
}

fn lighten(color: [4]f32, amount: f32) [4]f32 {
    return .{
        color[0] + ((1.0 - color[0]) * amount),
        color[1] + ((1.0 - color[1]) * amount),
        color[2] + ((1.0 - color[2]) * amount),
        color[3],
    };
}

fn darken(color: [4]f32, amount: f32) [4]f32 {
    return .{
        color[0] * (1.0 - amount),
        color[1] * (1.0 - amount),
        color[2] * (1.0 - amount),
        color[3],
    };
}

extern fn glClearColor(red: f32, green: f32, blue: f32, alpha: f32) void;
extern fn glClear(mask: u32) void;

const GL_COLOR_BUFFER_BIT: u32 = 0x0000_4000;
