//! Minimal native shell prototype for the desktop chat workflow.

const std = @import("std");
const zgui = @import("zgui");
const sdl = @import("zsdl3");

const log = std.log.scoped(.native_shell);
const ORG_NAME: [:0]const u8 = "Verde";
const APP_NAME: [:0]const u8 = "Native";
const STATE_FILE_NAME = "state.json";

const COLOR_GREEN = rgb(0x05, 0xa5, 0x4c);
const COLOR_YELLOW = rgb(0xfb, 0xbf, 0x24);
const COLOR_BLACK = rgb(0x1f, 0x1f, 0x1f);
const COLOR_WHITE = rgb(0xff, 0xff, 0xff);
const COLOR_PANEL = rgba(40, 40, 40, 255);
const COLOR_PANEL_ALT = rgba(47, 47, 47, 255);
const COLOR_PANEL_MUTED = rgba(58, 58, 58, 255);
const COLOR_TEXT_MUTED = rgba(191, 191, 191, 255);
const COLOR_TEXT_SUBTLE = rgba(153, 153, 153, 255);

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

const ChatMessage = struct {
    role: ChatRole,
    author: [:0]const u8,
    body: [:0]const u8,
};

const ChatThread = struct {
    title: [:0]const u8,
    provider: Provider = .opencode,
    harness: Harness = .local_cli,
    messages: std.ArrayList(ChatMessage),
    draft_storage: [AppState.DRAFT_CAPACITY:0]u8,

    fn init(allocator: std.mem.Allocator, title: []const u8) !ChatThread {
        return .{
            .title = try allocator.dupeZ(u8, title),
            .provider = .opencode,
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

    fn deinit(self: *ChatThread, allocator: std.mem.Allocator) void {
        allocator.free(self.title);
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
        var title_buf: [64]u8 = undefined;
        const title = try std.fmt.bufPrint(&title_buf, "Thread {d}", .{self.threads.items.len + 1});
        try self.threads.append(allocator, try ChatThread.init(allocator, title));
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
            try stringify.write(project.selected_thread_index);
            try stringify.objectField("threads");
            try stringify.beginArray();
            for (project.threads.items) |thread| {
                try stringify.beginObject();
                try stringify.objectField("title");
                try stringify.write(thread.title);
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

        try self.appendMessage(.user, "You", draft);
        const thread = self.currentThreadMutable();
        const response = switch (thread.provider) {
            .opencode => "OpenCode would receive this message through the selected harness and return the next tool-aware reply here.",
            .codex => "Codex would receive this message through the selected harness and stream its response into this transcript.",
        };
        try self.appendMessage(.assistant, providerLabel(thread.provider), response);
        self.clearDraft();
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
                    try loaded.threads.append(self.allocator, thread);
                }
                if (loaded.threads.items.len == 0) {
                    try loaded.addThread(self.allocator);
                }
                loaded.selected_thread_index = @min(project.selected_thread_index, loaded.threads.items.len - 1);
            } else {
                var thread = try ChatThread.init(self.allocator, "Thread 1");
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

    fn dupeZ(self: *AppState, value: []const u8) ![:0]const u8 {
        return try self.allocator.dupeZ(u8, value);
    }

    fn deinit(self: *AppState) void {
        self.finishPickerThread();
        for (self.projects.items) |*project| {
            project.deinit(self.allocator);
        }
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

    fn finishPickerThread(self: *AppState) void {
        self.picker_state.mutex.lock();
        const maybe_worker = self.picker_state.worker;
        self.picker_state.worker = null;
        self.picker_state.mutex.unlock();

        if (maybe_worker) |worker| {
            worker.join();
        }
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

    zgui.init(allocator);
    defer zgui.deinit();
    zgui.backend.init(window, gl_context);
    defer zgui.backend.deinit();

    applyTheme();

    var state = try AppState.init(allocator, &storage);
    defer state.deinit();

    var running = true;
    while (running) {
        running = processEvents();
        state.pollPicker();

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

fn processEvents() bool {
    var event: sdl.Event = undefined;
    while (sdl.pollEvent(&event)) {
        _ = zgui.backend.processEvent(&event);
        switch (event.type) {
            .quit => return false,
            else => {},
        }
    }

    return true;
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
        if (zgui.button("N", .{ .w = 28.0, .h = 28.0 })) {
            state.createThreadForProject(index);
        }
        if (zgui.isItemHovered(.{ .delay_normal = true })) {
            _ = zgui.beginTooltip();
            zgui.textUnformatted("New thread");
            zgui.endTooltip();
        }
        zgui.popStyleColor(.{ .count = 3 });

        if (is_selected) {
            zgui.popStyleColor(.{ .count = 3 });
        }

        const active_thread = state.projects.items[index].currentThread();
        zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{project.path});
        zgui.textColored(COLOR_TEXT_MUTED, "{s}  |  {s}", .{
            providerLabel(active_thread.provider),
            harnessLabel(active_thread.harness),
        });
        zgui.textColored(COLOR_TEXT_SUBTLE, "{d} threads  |  {d} messages", .{
            project.threads.items.len,
            active_thread.messages.items.len,
        });
        if (active_thread.messages.items.len > 0) {
            zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{lastMessagePreview(&project)});
        } else {
            zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{active_thread.title});
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
    zgui.textColored(COLOR_TEXT_SUBTLE, "{s}  |  {d} total threads", .{
        thread.title,
        project.threads.items.len,
    });

    const editable_thread = state.currentThreadMutable();
    if (zgui.comboFromEnum("Provider", &editable_thread.provider)) {
        state.markDirty();
    }
    zgui.sameLine(.{ .spacing = 18.0 });
    if (zgui.comboFromEnum("Harness", &editable_thread.harness)) {
        state.markDirty();
    }
    zgui.sameLine(.{ .spacing = 18.0 });
    zgui.textColored(COLOR_GREEN, "Focused mode: chat only", .{});
}

fn renderTranscript(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("Transcript", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
    });
    defer zgui.endChild();

    if (state.currentThread().messages.items.len == 0) {
        zgui.textColored(COLOR_WHITE, "No messages yet", .{});
        zgui.textColored(COLOR_TEXT_MUTED, "Choose a provider, type a prompt below, and start the first chat for this directory.", .{});
        return;
    }

    for (state.currentThread().messages.items, 0..) |message, index| {
        const bubble_color = messageBubbleColor(message.role);
        zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = bubble_color });

        _ = zgui.beginChildId(@intCast(index + 1), .{
            .w = 0.0,
            .h = 88.0,
            .child_flags = .{ .border = true },
        });
        zgui.textColored(COLOR_WHITE, "{s}", .{message.author});
        zgui.pushTextWrapPos(0.0);
        zgui.textWrapped("{s}", .{message.body});
        zgui.popTextWrapPos();
        zgui.endChild();
        zgui.popStyleColor(.{ .count = 1 });
        zgui.spacing();
    }

    zgui.setScrollHereY(.{ .center_y_ratio = 1.0 });
}

fn renderComposer(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("Composer", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = true },
    });
    defer zgui.endChild();

    zgui.textColored(COLOR_WHITE, "Prompt", .{});
    const submitted = zgui.inputTextMultiline("##chat-draft", .{
        .buf = state.draftBuffer(),
        .w = width - 18.0,
        .h = 78.0,
        .flags = .{
            .ctrl_enter_for_new_line = true,
            .enter_returns_true = true,
        },
    });

    if (submitted or zgui.button("Send", .{ .w = 96.0, .h = 32.0 })) {
        state.sendDraft() catch |err| {
            log.err("failed to send draft: {s}", .{@errorName(err)});
        };
    }

    zgui.sameLine(.{ .spacing = 12.0 });
    if (zgui.button("Clear", .{ .w = 96.0, .h = 32.0 })) {
        state.clearDraft();
    }

    zgui.sameLine(.{ .spacing = 18.0 });
    zgui.textColored(COLOR_TEXT_MUTED, "Enter sends. Ctrl+Enter keeps a newline.", .{});
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
