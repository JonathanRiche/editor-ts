//! Minimal native shell prototype for the desktop chat workflow.

const std = @import("std");
const app_config = @import("config.zig");
const keybinds = @import("keybinds.zig");
const zgui = @import("zgui");
const sdl = @import("zsdl3");
const ai_harness = @import("harness.zig");

const log = std.log.scoped(.native_shell);
const ORG_NAME: [:0]const u8 = "Verde";
const APP_NAME: [:0]const u8 = "Native";
const STATE_FILE_NAME = "state.json";
const GEIST_SANS_BYTES = @embedFile("assets/fonts/Geist-Regular.ttf");
const DEFAULT_FONT_SIZE: f32 = 18.0;

const COLOR_GREEN = rgb(0x05, 0xa5, 0x4c);
const COLOR_YELLOW = rgb(0xfb, 0xbf, 0x24);
const COLOR_BLACK = rgb(0x1f, 0x1f, 0x1f);
const COLOR_WHITE = rgb(0xff, 0xff, 0xff);
const COLOR_PANEL = rgba(40, 40, 40, 255);
const COLOR_PANEL_ALT = rgba(47, 47, 47, 255);
const COLOR_PANEL_MUTED = rgba(58, 58, 58, 255);
const COLOR_TEXT_MUTED = rgba(191, 191, 191, 255);
const COLOR_TEXT_SUBTLE = rgba(153, 153, 153, 255);
const COLOR_DIFF_ADD = rgba(48, 214, 167, 255);
const COLOR_DIFF_REMOVE = rgba(255, 96, 96, 255);
const TRANSCRIPT_BUBBLE_PADDING_X: f32 = 14.0;
const TRANSCRIPT_BUBBLE_PADDING_Y: f32 = 12.0;
const TRANSCRIPT_BUBBLE_ROUNDING: f32 = 12.0;

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

const ChatMessage = struct {
    role: ChatRole,
    author: [:0]const u8,
    body: [:0]const u8,
};

const ChangedFileEntry = struct {
    path: []const u8,
    additions: i64,
    deletions: i64,
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
        }
        self.messages.deinit(allocator);
    }
};

const Project = struct {
    id: [:0]const u8,
    label: [:0]const u8,
    path: [:0]const u8,
    unread_count: u8 = 0,
    threads: std.ArrayList(ChatThread),
    selected_thread_index: usize = 0,

    fn init(allocator: std.mem.Allocator, id: []const u8, label: []const u8, path: []const u8, unread_count: u8) !Project {
        var project: Project = .{
            .id = try allocator.dupeZ(u8, id),
            .label = try allocator.dupeZ(u8, label),
            .path = try allocator.dupeZ(u8, path),
            .unread_count = unread_count,
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
    messages: []const PersistedMessage = &.{},
};

const PersistedMessage = struct {
    role: ChatRole,
    author: []const u8,
    body: []const u8,
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
    messages: []const SaveMessage,
};

const SaveMessage = struct {
    role: ChatRole,
    author: []const u8,
    body: []const u8,
};

const SaveState = struct {
    selected_project_index: usize,
    projects: []const SaveProject,
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
    title: []u8,
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
    project_index: ?usize = null,
    thread_index: ?usize = null,
    partial_text: std.ArrayListUnmanaged(u8) = .empty,
    pending_events: std.ArrayListUnmanaged(PendingTimelineEvent) = .empty,
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
    show_project_creator: bool,
    picker_state: PickerState,
    send_state: SendState,
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
            .show_project_creator = false,
            .picker_state = .{},
            .send_state = .{},
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

    fn appendMessage(self: *AppState, role: ChatRole, author: []const u8, body: []const u8) !void {
        const thread = self.currentThreadMutable();
        if (thread.messages.items.len == 24) {
            const removed = thread.messages.orderedRemove(0);
            self.allocator.free(removed.author);
            self.allocator.free(removed.body);
        }

        try thread.messages.append(self.allocator, .{
            .role = role,
            .author = try self.dupeZ(author),
            .body = try self.dupeZ(body),
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
        if (draft.len == 0) return;

        self.send_state.mutex.lock();
        const send_pending = self.send_state.status == .pending;
        self.send_state.mutex.unlock();
        if (send_pending) {
            self.setSidebarNotice("A provider request is already running.");
            return;
        }

        const trimmed_title = std.mem.trim(u8, draft, &std.ascii.whitespace);
        const thread = self.currentThreadMutable();
        if (!thread.committed) {
            try thread.commitFromPrompt(self.allocator, trimmed_title);
        }
        try self.appendMessage(.user, "You", draft);
        try self.beginSendDraft(draft);
        self.clearDraft();
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
            .provider_thread_id = if (thread.provider_thread_id) |thread_id| try page_alloc.dupe(u8, thread_id) else null,
            .model_ref = if (thread.model_ref) |model_ref| try page_alloc.dupe(u8, model_ref) else null,
            .reasoning_effort = thread.reasoning_effort,
            .fast_mode = thread.fast_mode,
            .access_mode = thread.access_mode,
        };
        errdefer {
            page_alloc.free(request.project_path);
            page_alloc.free(request.prompt);
            if (request.provider_thread_id) |thread_id| page_alloc.free(thread_id);
            if (request.model_ref) |model_ref| page_alloc.free(model_ref);
        }

        self.send_state.mutex.lock();
        defer self.send_state.mutex.unlock();
        self.send_state.status = .pending;
        self.send_state.result = null;
        self.send_state.error_message = null;
        self.send_state.project_index = request.project_index;
        self.send_state.thread_index = request.thread_index;
        self.send_state.partial_text.clearRetainingCapacity();
        freePendingTimelineEventsLocked(page_alloc, &self.send_state.pending_events);
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
                    for (persisted_thread.messages) |message| {
                        try thread.messages.append(self.allocator, .{
                            .role = message.role,
                            .author = try self.dupeZ(message.author),
                            .body = try self.dupeZ(message.body),
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
                    });
                }
            }

            try loaded.normalize(self.allocator);

            try self.projects.append(self.allocator, loaded);
        }

        self.selected_project_index = @min(persisted.selected_project_index, self.projects.items.len - 1);
        self.next_project_number = self.projects.items.len + 1;
        self.syncRenameBuffer();
        self.dirty = false;
    }

    fn seedDefaultState(self: *AppState) !void {
        self.selected_project_index = 0;
        self.next_project_number = 1;
        self.syncRenameBuffer();
        self.dirty = false;
    }

    fn currentProject(self: *const AppState) *const Project {
        return &self.projects.items[self.selected_project_index];
    }

    fn currentProjectMutable(self: *AppState) *Project {
        return &self.projects.items[self.selected_project_index];
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
    }

    fn dupeZ(self: *AppState, value: []const u8) ![:0]const u8 {
        return try self.allocator.dupeZ(u8, value);
    }

    fn deinit(self: *AppState) void {
        self.finishPickerThread();
        self.finishSendThread();
        self.send_state.partial_text.deinit(std.heap.page_allocator);
        freePendingTimelineEvents(std.heap.page_allocator, &self.send_state.pending_events);
        freePendingApproval(std.heap.page_allocator, &self.send_state.pending_approval);
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

        self.send_state.mutex.lock();
        switch (self.send_state.status) {
            .completed => {
                completed_result = self.send_state.result;
                self.send_state.result = null;
                self.send_state.partial_text.clearRetainingCapacity();
                completed_events = self.send_state.pending_events;
                self.send_state.pending_events = .empty;
                freePendingApprovalLocked(std.heap.page_allocator, &self.send_state.pending_approval);
                self.send_state.approval_decision = null;
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
                freePendingApprovalLocked(std.heap.page_allocator, &self.send_state.pending_approval);
                self.send_state.approval_decision = null;
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
                    self.applyPendingTimelineEvents(result, &completed_events) catch |err| {
                        log.err("failed to apply timeline events: {s}", .{@errorName(err)});
                    };
                    self.applySendSuccess(result) catch |err| {
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

    fn applySendSuccess(self: *AppState, result: SendResultPayload) !void {
        if (result.project_index >= self.projects.items.len) return;
        const project = &self.projects.items[result.project_index];
        if (result.thread_index >= project.threads.items.len) return;
        const thread = &project.threads.items[result.thread_index];

        if (thread.provider_thread_id) |thread_id| {
            self.allocator.free(thread_id);
        }
        thread.provider_thread_id = try self.allocator.dupeZ(u8, result.provider_thread_id);
        try thread.messages.append(self.allocator, .{
            .role = .assistant,
            .author = try self.dupeZ(providerLabel(thread.provider)),
            .body = try self.dupeZ(result.reply_text),
        });
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
                .role = .system,
                .author = try self.dupeZ(event.title),
                .body = try self.dupeZ(event.body),
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

    const window = try sdl.Window.create(
        "Verde",
        1360,
        860,
        .{
            .resizable = true,
            .high_pixel_density = true,
            .opengl = true,
        },
    );
    defer window.destroy();

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

    applyTheme();

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
        try window.getSize(&fb_width, &fb_height);
        zgui.backend.newFrame(@intCast(fb_width), @intCast(fb_height));

        renderRoot(&state, @floatFromInt(fb_width), @floatFromInt(fb_height));
        state.flushIfDirty();

        glClearColor(COLOR_BLACK[0], COLOR_BLACK[1], COLOR_BLACK[2], 1.0);
        glClear(GL_COLOR_BUFFER_BIT);
        zgui.backend.draw();
        try sdl.gl.swapWindow(window);
    }
}

fn processEvents(state: *AppState, keyboard: *keybinds.NativeKeyboardConfig) bool {
    var event: sdl.Event = undefined;
    while (sdl.pollEvent(&event)) {
        _ = zgui.backend.processEvent(&event);
        switch (event.type) {
            .quit => return false,
            .key_down => {
                const action = keyboard.actionForEvent(&event.key) orelse continue;
                handleKeyboardAction(state, keyboard, action);
            },
            else => {},
        }
    }

    return true;
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
    renderSidebar(state, 252.0, content[1]);
    zgui.sameLine(.{ .spacing = 18.0 });
    renderChatWorkspace(state, content[0] - 270.0, content[1]);
}

fn renderSidebar(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("ProjectsRail", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
        .window_flags = .{ .no_scrollbar = true },
    });
    defer zgui.endChild();

    zgui.textColored(COLOR_TEXT_MUTED, "PROJECTS", .{});
    zgui.sameLine(.{ .spacing = width - 82.0 });
    if (state.show_project_creator) {
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.06) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.12) });
        if (zgui.button("x", .{ .w = 24.0, .h = 24.0 })) {
            state.show_project_creator = false;
            state.clearImportPath();
            state.setSidebarNotice("");
        }
        zgui.popStyleColor(.{ .count = 3 });
    } else if (zgui.button("+", .{ .w = 24.0, .h = 24.0 })) {
        state.show_project_creator = true;
        state.setSidebarNotice("");
    }

    if (state.show_project_creator) {
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
        zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 12.0, 10.0 } });
        zgui.pushStyleVar2f(.{ .idx = .item_spacing, .v = .{ 8.0, 8.0 } });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.05) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.10) });
        zgui.pushStyleColor4f(.{ .idx = .border, .c = lighten(COLOR_PANEL_MUTED, 0.08) });
        if (zgui.button("[]  Browse for folder", .{ .w = width - 18.0, .h = 40.0 })) {
            state.browseForProjectDirectory();
        }
        zgui.popStyleColor(.{ .count = 4 });

        zgui.pushItemWidth(width - 88.0);
        _ = zgui.inputTextWithHint("##project-import", .{
            .hint = "/path/to/project",
            .buf = state.importPathBuffer(),
        });
        zgui.popItemWidth();
        zgui.sameLine(.{ .spacing = 8.0 });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_GREEN });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_GREEN, 0.10) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = darken(COLOR_GREEN, 0.10) });
        if (zgui.button("Add", .{ .w = 56.0, .h = 40.0 })) {
            state.importProjectFromInput() catch |err| {
                state.setSidebarNotice(@errorName(err));
            };
        }
        zgui.popStyleColor(.{ .count = 3 });

        if (state.sidebarNotice().len > 0) {
            zgui.textColored(COLOR_YELLOW, "{s}", .{state.sidebarNotice()});
        }
        zgui.popStyleVar(.{ .count = 2 });
        zgui.dummy(.{ .w = 0.0, .h = 4.0 });
    }

    if (state.projects.items.len > 0) {
        zgui.separatorText("Selected");
        _ = zgui.inputTextWithHint("##project-rename", .{
            .hint = "Project label",
            .buf = state.renameBuffer(),
        });
        if (zgui.button("Rename", .{ .w = 76.0, .h = 28.0 })) {
            state.renameSelectedProject();
        }
        zgui.sameLine(.{ .spacing = 10.0 });
        if (zgui.button("Remove", .{ .w = 76.0, .h = 28.0 })) {
            state.removeSelectedProject();
        }
        zgui.spacing();
    }

    for (state.projects.items, 0..) |project, index| {
        zgui.pushIntId(@intCast(index));
        defer zgui.popId();

        const is_selected = state.selected_project_index == index;
        if (is_selected) {
            zgui.pushStyleColor4f(.{ .idx = .header, .c = darken(COLOR_GREEN, 0.10) });
            zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = COLOR_GREEN });
            zgui.pushStyleColor4f(.{ .idx = .header_active, .c = lighten(COLOR_GREEN, 0.12) });
        }

        if (zgui.selectable(project.label, .{
            .selected = is_selected,
            .w = width - 52.0,
            .h = 44.0,
        })) {
            state.selected_project_index = index;
            state.syncRenameBuffer();
            state.markDirty();
        }

        zgui.sameLine(.{ .spacing = 8.0 });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.08) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.14) });
        if (zgui.smallButton("+")) {
            state.createThreadForProject(index);
        }
        if (zgui.isItemHovered(.{ .delay_normal = true })) {
            _ = zgui.beginTooltip();
            zgui.textUnformatted("Start a new chat");
            zgui.endTooltip();
        }
        zgui.popStyleColor(.{ .count = 3 });

        if (is_selected) {
            zgui.popStyleColor(.{ .count = 3 });
        }

        const active_thread = state.projects.items[index].currentThread();
        zgui.textDisabled("{d} saved chats", .{project.committedThreadCount()});
        if (is_selected) {
            zgui.indent(.{ .indent_w = 12.0 });
            for (project.threads.items, 0..) |thread, thread_index| {
                if (!thread.committed) continue;
                zgui.pushIntId(@intCast(thread_index + 1000));
                defer zgui.popId();
                const thread_selected = project.selected_thread_index == thread_index;
                var row_label_buf = std.mem.zeroes([96:0]u8);
                const row_label = formatThreadRowLabel(&row_label_buf, &thread);
                if (thread_selected) {
                    zgui.pushStyleColor4f(.{ .idx = .header, .c = COLOR_PANEL_ALT });
                    zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = lighten(COLOR_PANEL_ALT, 0.06) });
                    zgui.pushStyleColor4f(.{ .idx = .header_active, .c = lighten(COLOR_PANEL_ALT, 0.12) });
                }
                zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 6.0, 5.0 } });
                if (zgui.selectable(row_label, .{
                    .selected = thread_selected,
                    .w = width - 44.0,
                    .h = 24.0,
                })) {
                    state.selected_project_index = index;
                    state.projects.items[index].selected_thread_index = thread_index;
                    state.syncRenameBuffer();
                    state.markDirty();
                }
                zgui.popStyleVar(.{ .count = 1 });
                var preview_buf = std.mem.zeroes([72:0]u8);
                const preview = formatThreadPreview(&preview_buf, &thread);
                if (preview.len > 0) {
                    zgui.textColored(if (thread_selected) COLOR_TEXT_MUTED else COLOR_TEXT_SUBTLE, "{s}", .{preview});
                }
                if (thread_selected) {
                    zgui.popStyleColor(.{ .count = 3 });
                }
                zgui.dummy(.{ .w = 0.0, .h = 2.0 });
            }
            if (!active_thread.committed) {
                zgui.textColored(COLOR_TEXT_SUBTLE, "New chat will appear here after the first prompt.", .{});
            }
            zgui.unindent(.{ .indent_w = 12.0 });
        } else if (active_thread.messages.items.len > 0) {
            var time_buf: [24]u8 = undefined;
            const relative_time = formatRelativeTime(&time_buf, active_thread.last_activity_at);
            zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{lastMessagePreview(&project)});
            zgui.textDisabled("{s}", .{relative_time});
        } else if (active_thread.committed) {
            zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{active_thread.title});
        } else {
            zgui.textColored(COLOR_TEXT_SUBTLE, "No saved threads yet", .{});
        }
        if (project.unread_count > 0) {
            zgui.sameLine(.{ .spacing = 10.0 });
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
    const transcript_height = @max(content[1] - 164.0, 180.0);
    renderTranscript(state, width - 24.0, transcript_height);
    renderComposer(state, width - 24.0, content[1] - transcript_height - 8.0);
}

fn renderWorkspaceHeader(state: *AppState) void {
    const project = state.currentProject();
    const thread = state.currentThread();
    zgui.textColored(COLOR_WHITE, "{s}", .{project.label});
    zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{project.path});
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}  |  {d} saved threads", .{
        if (thread.committed) thread.title else "New chat",
        project.committedThreadCount(),
    });

    zgui.textColored(COLOR_GREEN, "Focused mode: chat only", .{});
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
        renderTranscriptBubbleId(@intCast(index + 1), message.role, message.author, message.body);
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    }

    if (has_pending_stream) {
        renderPendingApproval(state);
        renderPendingTimelineEvents(state);
        renderPendingTranscriptBubble(state);
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    }

    if (should_follow_stream) {
        zgui.setScrollHereY(.{ .center_y_ratio = 1.0 });
    }
}

fn renderPendingApproval(state: *AppState) void {
    var snapshot = state.pendingApprovalSnapshot() catch null;
    defer freePendingApproval(state.allocator, &snapshot);

    if (snapshot) |approval| {
        renderTranscriptBubble("pending-approval-body", .system, approval.title, approval.body, false);
        zgui.dummy(.{ .w = 0.0, .h = 4.0 });
        zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_PANEL_ALT });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_PANEL_ALT, 0.08) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = lighten(COLOR_PANEL_ALT, 0.14) });
        defer zgui.popStyleColor(.{ .count = 3 });
        if (zgui.button("Approve", .{ .w = 110.0, .h = 30.0 })) {
            state.resolvePendingApproval(.approve);
        }
        zgui.sameLine(.{ .spacing = 10.0 });
        if (zgui.button("Deny", .{ .w = 110.0, .h = 30.0 })) {
            state.resolvePendingApproval(.deny);
        }
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
    }
}

fn renderPendingTimelineEvents(state: *AppState) void {
    state.send_state.mutex.lock();
    defer state.send_state.mutex.unlock();

    if (state.send_state.status != .pending) return;
    if (state.send_state.project_index != state.selected_project_index) return;
    if (state.send_state.thread_index != state.currentProject().selected_thread_index) return;

    for (state.send_state.pending_events.items, 0..) |event, index| {
        renderTranscriptMessage(@intCast(50_000 + index), .system, event.title, event.body);
        zgui.dummy(.{ .w = 0.0, .h = 6.0 });
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
        "pending-assistant",
        .assistant,
        providerLabel(state.currentThread().provider),
        if (stream_text.len > 0) stream_text else "Waiting for streamed output...",
        stream_text.len == 0,
    );
}

fn renderTranscriptBubbleId(id: u32, role: ChatRole, author: []const u8, body: []const u8) void {
    renderTranscriptMessage(id, role, author, body);
}

fn renderTranscriptMessage(id: u32, role: ChatRole, author: []const u8, body: []const u8) void {
    if (role == .system and std.mem.eql(u8, author, "Changed files")) {
        renderChangedFilesCardId(id, body);
        return;
    }
    if (role == .system and (std.mem.eql(u8, author, "Ran command") or std.mem.eql(u8, author, "Command failed"))) {
        renderCommandEventRowId(id, author, body);
        return;
    }

    const theme = transcriptBubbleTheme(role);
    const bubble_height = transcriptBubbleHeight(author, body);
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
    zgui.pushTextWrapPos(0.0);
    zgui.textWrapped("{s}", .{body});
    zgui.popTextWrapPos();
}

fn renderTranscriptBubble(id: [:0]const u8, role: ChatRole, author: []const u8, body: []const u8, muted_body: bool) void {
    const theme = transcriptBubbleTheme(role);
    const bubble_height = transcriptBubbleHeight(author, body);
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
    zgui.pushTextWrapPos(0.0);
    if (muted_body) {
        zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{body});
    } else {
        zgui.textWrapped("{s}", .{body});
    }
    zgui.popTextWrapPos();
}

fn renderCommandEventRowId(id: u32, author: []const u8, body: []const u8) void {
    const row_height: f32 = 36.0;
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 10.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 12.0, 8.0 } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(34, 34, 34, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(52, 52, 52, 255) });
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
    const card_height = changedFilesCardHeight(entries.items.len);

    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 14.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 16.0, 14.0 } });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(38, 38, 38, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(70, 70, 70, 255) });
    _ = zgui.beginChildId(id, .{
        .w = 0.0,
        .h = card_height,
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
        entries.deinit(std.heap.page_allocator);
    }

    renderChangedFilesHeader(entries.items.len, totals.additions, totals.deletions);
    zgui.sameLine(.{ .spacing = 12.0 });
    renderChangedFilesAction("Collapse all");
    zgui.sameLine(.{ .spacing = 10.0 });
    renderChangedFilesAction("View diff");
    zgui.dummy(.{ .w = 0.0, .h = 10.0 });

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

fn renderChangedFilesAction(label: [:0]const u8) void {
    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 12.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 12.0, 7.0 } });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = rgba(52, 52, 52, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = rgba(58, 58, 58, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = rgba(64, 64, 64, 255) });
    defer {
        zgui.popStyleColor(.{ .count = 3 });
        zgui.popStyleVar(.{ .count = 2 });
    }
    _ = zgui.button(label, .{ .h = 32.0 });
}

fn renderChangedFilesFolder(path: []const u8) void {
    zgui.textColored(COLOR_TEXT_MUTED, "v  {s}", .{path});
    zgui.dummy(.{ .w = 0.0, .h = 4.0 });
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
    zgui.dummy(.{ .w = 0.0, .h = 6.0 });
}

fn changedFilesCardHeight(file_count: usize) f32 {
    return @max(92.0 + (@as(f32, @floatFromInt(file_count)) * 32.0), 126.0);
}

fn parseChangedFileEntries(body: []const u8) std.ArrayListUnmanaged(ChangedFileEntry) {
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

fn transcriptBubbleHeight(author: []const u8, body: []const u8) f32 {
    const style = zgui.getStyle();
    const avail = zgui.getContentRegionAvail();
    const inner_width = @max(avail[0] - (TRANSCRIPT_BUBBLE_PADDING_X * 2.0), 64.0);
    const author_size = zgui.calcTextSize(author, .{});
    const body_size = zgui.calcTextSize(body, .{ .wrap_width = inner_width });
    const vertical_padding = TRANSCRIPT_BUBBLE_PADDING_Y * 2.0;
    const text_gap = 2.0 + style.item_spacing[1];
    const border_allowance = 4.0;
    return @max(author_size[1] + body_size[1] + vertical_padding + text_gap + border_allowance, 56.0);
}

const TranscriptBubbleTheme = struct {
    background: [4]f32,
    border: [4]f32,
    author: [4]f32,
};

fn transcriptBubbleTheme(role: ChatRole) TranscriptBubbleTheme {
    return switch (role) {
        .user => .{
            .background = darken(COLOR_GREEN, 0.22),
            .border = rgba(22, 160, 85, 255),
            .author = rgba(222, 255, 236, 255),
        },
        .assistant => .{
            .background = rgba(50, 50, 50, 255),
            .border = rgba(86, 86, 86, 255),
            .author = rgba(214, 214, 214, 255),
        },
        .system => .{
            .background = darken(COLOR_YELLOW, 0.48),
            .border = rgba(138, 108, 22, 255),
            .author = rgba(255, 240, 186, 255),
        },
    };
}

fn transcriptShouldAutoFollow(state: *AppState) bool {
    if (!isSendPending(state)) return false;
    const scroll_max_y = zgui.getScrollMaxY();
    if (scroll_max_y <= 0.0) return true;
    const scroll_y = zgui.getScrollY();
    return (scroll_max_y - scroll_y) <= 72.0;
}

fn renderComposer(state: *AppState, width: f32, height: f32) void {
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 14.0 });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = rgba(34, 34, 34, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = rgba(64, 64, 64, 255) });
    _ = zgui.beginChild("Composer", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
    });
    defer {
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 2 });
        zgui.popStyleVar(.{ .count = 1 });
    }

    zgui.textColored(COLOR_TEXT_MUTED, "Prompt", .{});
    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 12.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 14.0, 12.0 } });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg, .c = rgba(42, 42, 42, 255) });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_hovered, .c = rgba(46, 46, 46, 255) });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_active, .c = rgba(50, 50, 50, 255) });
    const submitted = zgui.inputTextMultiline("##chat-draft", .{
        .buf = state.draftBuffer(),
        .w = width - 18.0,
        .h = 88.0,
        .flags = .{
            .ctrl_enter_for_new_line = true,
            .enter_returns_true = true,
        },
    });
    zgui.popStyleColor(.{ .count = 3 });
    zgui.popStyleVar(.{ .count = 2 });

    zgui.dummy(.{ .w = 0.0, .h = 2.0 });

    if (submitted or zgui.button("Send", .{ .w = 96.0, .h = 32.0 })) {
        state.sendDraft() catch |err| {
            log.err("failed to send draft: {s}", .{@errorName(err)});
        };
    }

    zgui.sameLine(.{ .spacing = 12.0 });
    if (zgui.button("Clear", .{ .w = 96.0, .h = 32.0 })) {
        state.clearDraft();
    }

    zgui.sameLine(.{ .spacing = 22.0 });
    renderComposerPickers(state);
    zgui.sameLine(.{ .spacing = 18.0 });
    if (isSendPending(state)) {
        zgui.textColored(COLOR_YELLOW, "Working...", .{});
    } else {
        zgui.textColored(COLOR_TEXT_SUBTLE, "Enter sends. Ctrl+Enter keeps a newline.", .{});
    }
}

fn renderComposerPickers(state: *AppState) void {
    const thread = state.currentThreadMutable();
    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 11.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 12.0, 7.0 } });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg, .c = darken(COLOR_PANEL_ALT, 0.02) });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_hovered, .c = lighten(COLOR_PANEL_ALT, 0.05) });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_active, .c = lighten(COLOR_PANEL_ALT, 0.10) });
    zgui.pushStyleColor4f(.{ .idx = .popup_bg, .c = rgba(28, 28, 28, 248) });
    zgui.pushStyleColor4f(.{ .idx = .header, .c = COLOR_PANEL_ALT });
    zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = lighten(COLOR_PANEL_ALT, 0.08) });
    zgui.pushStyleColor4f(.{ .idx = .header_active, .c = lighten(COLOR_PANEL_ALT, 0.14) });
    defer {
        zgui.popStyleColor(.{ .count = 7 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    var provider_preview_buf = std.mem.zeroes([48:0]u8);
    const provider_preview = comboPreviewLabel(&provider_preview_buf, providerLabel(thread.provider));
    zgui.setNextItemWidth(148.0);
    if (zgui.beginCombo("##provider-picker", .{ .preview_value = provider_preview })) {
        defer zgui.endCombo();
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
    }

    zgui.sameLine(.{ .spacing = 12.0 });
    const model_preview = selectedModelLabel(thread);
    var model_preview_buf = std.mem.zeroes([80:0]u8);
    const model_preview_label = comboPreviewLabel(&model_preview_buf, model_preview);
    zgui.setNextItemWidth(186.0);
    if (zgui.beginCombo("##model-picker", .{ .preview_value = model_preview_label })) {
        defer zgui.endCombo();
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
        zgui.sameLine(.{ .spacing = 12.0 });
        const reasoning_preview = selectedReasoningLabel(thread);
        var reasoning_preview_buf = std.mem.zeroes([80:0]u8);
        const reasoning_preview_label = comboPreviewLabel(&reasoning_preview_buf, reasoning_preview);
        zgui.setNextItemWidth(148.0);
        if (zgui.beginCombo("##reasoning-picker", .{ .preview_value = reasoning_preview_label })) {
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

        zgui.sameLine(.{ .spacing = 12.0 });
        const fast_mode_preview = fastModeLabel(thread.fast_mode);
        var fast_mode_preview_buf = std.mem.zeroes([64:0]u8);
        const fast_mode_preview_label = comboPreviewLabel(&fast_mode_preview_buf, fast_mode_preview);
        zgui.setNextItemWidth(108.0);
        if (zgui.beginCombo("##fast-mode-picker", .{ .preview_value = fast_mode_preview_label })) {
            defer zgui.endCombo();
            for (CODEX_FAST_MODE_OPTIONS) |option| {
                const is_selected = thread.fast_mode == option.value;
                var row_buf = std.mem.zeroes([64:0]u8);
                const row_label = comboRowLabel(&row_buf, option.label, is_selected);
                if (zgui.selectable(row_label, .{ .selected = is_selected, .h = 28.0 })) {
                    thread.fast_mode = option.value;
                    state.markDirty();
                }
            }
        }

        zgui.sameLine(.{ .spacing = 12.0 });
        const access_mode_preview = accessModeLabel(thread.access_mode);
        var access_mode_preview_buf = std.mem.zeroes([96:0]u8);
        const access_mode_preview_label = comboPreviewLabel(&access_mode_preview_buf, access_mode_preview);
        zgui.setNextItemWidth(156.0);
        if (zgui.beginCombo("##access-mode-picker", .{ .preview_value = access_mode_preview_label })) {
            defer zgui.endCombo();
            for (CODEX_ACCESS_MODE_OPTIONS) |option| {
                const is_selected = thread.access_mode == option.value;
                var row_buf = std.mem.zeroes([96:0]u8);
                const row_label = comboRowLabel(&row_buf, option.label, is_selected);
                if (zgui.selectable(row_label, .{ .selected = is_selected, .h = 28.0 })) {
                    if (thread.access_mode != option.value) {
                        thread.access_mode = option.value;
                        if (thread.provider_thread_id) |thread_id| {
                            state.allocator.free(thread_id);
                        }
                        thread.provider_thread_id = null;
                        state.markDirty();
                    }
                }
            }
        }
    }
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
}

fn applyTheme() void {
    zgui.styleColorsDark(zgui.getStyle());
    zgui.pushStyleVar1f(.{ .idx = .window_rounding, .v = 10.0 });
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 10.0 });
    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 8.0 });
    zgui.pushStyleVar1f(.{ .idx = .grab_rounding, .v = 8.0 });
    zgui.pushStyleColor4f(.{ .idx = .window_bg, .c = COLOR_BLACK });
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = COLOR_PANEL });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg, .c = COLOR_PANEL_ALT });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_hovered, .c = lighten(COLOR_PANEL_ALT, 0.08) });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_active, .c = lighten(COLOR_PANEL_ALT, 0.14) });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_GREEN });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = lighten(COLOR_GREEN, 0.10) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = darken(COLOR_GREEN, 0.10) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = COLOR_PANEL_MUTED });
    zgui.pushStyleColor4f(.{ .idx = .separator, .c = COLOR_PANEL_MUTED });
    zgui.pushStyleColor4f(.{ .idx = .check_mark, .c = COLOR_WHITE });
    zgui.pushStyleColor4f(.{ .idx = .text, .c = COLOR_WHITE });
    zgui.pushStyleColor4f(.{ .idx = .text_selected_bg, .c = rgba(5, 165, 76, 92) });
    zgui.pushStyleColor4f(.{ .idx = .title_bg, .c = COLOR_PANEL });
    zgui.pushStyleColor4f(.{ .idx = .title_bg_active, .c = COLOR_PANEL_ALT });
    zgui.pushStyleColor4f(.{ .idx = .header, .c = COLOR_PANEL_ALT });
    zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = COLOR_PANEL_MUTED });
    zgui.pushStyleColor4f(.{ .idx = .header_active, .c = COLOR_GREEN });
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

fn formatThreadPreview(buffer: *[72:0]u8, thread: *const ChatThread) [:0]const u8 {
    if (thread.messages.items.len == 0) return "Awaiting first prompt";
    const body = thread.messages.items[0].body;
    const max_len = @min(buffer.len - 1, @as(usize, 34));
    const source = std.mem.trim(u8, body, &std.ascii.whitespace);
    if (std.mem.eql(u8, source, thread.title)) return "";
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

fn formatThreadRowLabel(buffer: *[96:0]u8, thread: *const ChatThread) [:0]const u8 {
    var time_buf: [24]u8 = undefined;
    const relative_time = formatRelativeTime(&time_buf, thread.last_activity_at);
    const max_title_len = if (relative_time.len + 4 >= buffer.len - 1) 8 else (buffer.len - 1) - (relative_time.len + 4);

    var title_buf = std.mem.zeroes([64:0]u8);
    const title = truncatedThreadTitle(&title_buf, thread.title, max_title_len);
    const label = std.fmt.bufPrintZ(buffer, "{s}  {s}", .{ title, relative_time }) catch thread.title;
    return label;
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

fn pickDirectory(allocator: std.mem.Allocator, start_path: []const u8) ![]u8 {
    return switch (@import("builtin").os.tag) {
        .linux, .freebsd, .netbsd, .openbsd, .dragonfly => pickDirectoryLinux(allocator, start_path),
        else => error.UnsupportedOperatingSystem,
    };
}

fn pickDirectoryLinux(allocator: std.mem.Allocator, start_path: []const u8) ![]u8 {
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
        error.FolderPickerUnavailable => state.status = .unavailable,
        else => state.status = .failed,
    }
}

fn sendWorker(state: *SendState, request: *SendWorkerRequest) void {
    const page_alloc = std.heap.page_allocator;
    defer {
        page_alloc.free(request.project_path);
        page_alloc.free(request.prompt);
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

fn handleSendStreamEvent(context: ?*anyopaque, event: ai_harness.StreamEvent) void {
    const send_state: *SendState = @ptrCast(@alignCast(context orelse return));
    const page_alloc = std.heap.page_allocator;

    send_state.mutex.lock();
    defer send_state.mutex.unlock();
    if (send_state.status != .pending) return;

    if (send_state.pending_events.items.len > 0) {
        const last = send_state.pending_events.items[send_state.pending_events.items.len - 1];
        if (std.mem.eql(u8, last.title, event.title) and std.mem.eql(u8, last.body, event.body)) {
            return;
        }
    }

    const owned_title = page_alloc.dupe(u8, event.title) catch return;
    errdefer page_alloc.free(owned_title);
    const owned_body = page_alloc.dupe(u8, event.body) catch return;
    errdefer page_alloc.free(owned_body);

    send_state.pending_events.append(page_alloc, .{
        .title = owned_title,
        .body = owned_body,
    }) catch {
        page_alloc.free(owned_title);
        page_alloc.free(owned_body);
    };
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
        allocator.free(event.title);
        allocator.free(event.body);
    }
    events.deinit(allocator);
    events.* = .empty;
}

fn freePendingTimelineEventsLocked(allocator: std.mem.Allocator, events: *std.ArrayListUnmanaged(PendingTimelineEvent)) void {
    freePendingTimelineEvents(allocator, events);
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
