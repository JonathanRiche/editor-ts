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

const Project = struct {
    label: [:0]const u8,
    path: [:0]const u8,
    unread_count: u8 = 0,
};

const ChatRole = enum {
    user,
    assistant,
    system,
};

const Provider = enum {
    opencode,
    codex,
};

const Harness = enum {
    local_cli,
    remote_session,
};

const ChatMessage = struct {
    role: ChatRole,
    author: [:0]const u8,
    body: [:0]const u8,
};

const PersistedProject = struct {
    label: []const u8,
    path: []const u8,
    unread_count: u8 = 0,
};

const PersistedMessage = struct {
    role: ChatRole,
    author: []const u8,
    body: []const u8,
};

const PersistedState = struct {
    selected_project_index: usize = 0,
    provider: Provider = .opencode,
    harness: Harness = .local_cli,
    draft: []const u8 = "",
    projects: []const PersistedProject = &.{},
    messages: []const PersistedMessage = &.{},
};

const SaveProject = struct {
    label: []const u8,
    path: []const u8,
    unread_count: u8,
};

const SaveMessage = struct {
    role: ChatRole,
    author: []const u8,
    body: []const u8,
};

const SaveState = struct {
    selected_project_index: usize,
    provider: Provider,
    harness: Harness,
    draft: []const u8,
    projects: []const SaveProject,
    messages: []const SaveMessage,
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

        return try std.json.parseFromSlice(PersistedState, allocator, bytes, .{});
    }

    fn save(self: *const Storage, state: *const AppState) !void {
        var projects: std.ArrayList(SaveProject) = .empty;
        defer projects.deinit(self.allocator);

        for (state.projects.items) |project| {
            try projects.append(self.allocator, .{
                .label = project.label,
                .path = project.path,
                .unread_count = project.unread_count,
            });
        }

        var messages: std.ArrayList(SaveMessage) = .empty;
        defer messages.deinit(self.allocator);

        for (state.messages.items) |message| {
            try messages.append(self.allocator, .{
                .role = message.role,
                .author = message.author,
                .body = message.body,
            });
        }

        const snapshot: SaveState = .{
            .selected_project_index = state.selected_project_index,
            .provider = state.provider,
            .harness = state.harness,
            .draft = state.currentDraft(),
            .projects = projects.items,
            .messages = messages.items,
        };

        var buffer: std.Io.Writer.Allocating = .init(self.allocator);
        defer buffer.deinit();

        var stringify: std.json.Stringify = .{
            .writer = &buffer.writer,
            .options = .{ .whitespace = .indent_2 },
        };
        try stringify.write(snapshot);

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
    provider: Provider,
    harness: Harness,
    messages: std.ArrayList(ChatMessage),
    draft_storage: [DRAFT_CAPACITY:0]u8,
    next_project_number: usize,
    dirty: bool,

    fn init(allocator: std.mem.Allocator, storage: *const Storage) !AppState {
        var state: AppState = .{
            .allocator = allocator,
            .storage = storage,
            .projects = .empty,
            .selected_project_index = 0,
            .provider = .opencode,
            .harness = .local_cli,
            .messages = .empty,
            .draft_storage = std.mem.zeroes([DRAFT_CAPACITY:0]u8),
            .next_project_number = 4,
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
        try self.projects.append(self.allocator, .{
            .label = try self.dupeZ(label),
            .path = try self.dupeZ(path),
            .unread_count = unread_count,
        });
        self.markDirty();
    }

    fn appendMessage(self: *AppState, role: ChatRole, author: []const u8, body: []const u8) !void {
        if (self.messages.items.len == 24) {
            const removed = self.messages.orderedRemove(0);
            self.allocator.free(removed.author);
            self.allocator.free(removed.body);
        }

        try self.messages.append(self.allocator, .{
            .role = role,
            .author = try self.dupeZ(author),
            .body = try self.dupeZ(body),
        });
        self.markDirty();
    }

    fn addProjectFromDraft(self: *AppState) !void {
        var label_buffer: [64]u8 = undefined;
        const label = try std.fmt.bufPrint(&label_buffer, "Project {d}", .{self.next_project_number});

        var path_buffer: [160]u8 = undefined;
        const path = try std.fmt.bufPrint(&path_buffer, "~/projects/native-{d}", .{self.next_project_number});

        try self.addProject(label, path, 0);
        self.selected_project_index = self.projects.items.len - 1;
        self.next_project_number += 1;
        self.markDirty();
    }

    fn sendDraft(self: *AppState) !void {
        const draft = self.currentDraft();
        if (draft.len == 0) return;

        try self.appendMessage(.user, "You", draft);
        const response = switch (self.provider) {
            .opencode => "OpenCode would receive this message through the selected harness and return the next tool-aware reply here.",
            .codex => "Codex would receive this message through the selected harness and stream its response into this transcript.",
        };
        try self.appendMessage(.assistant, providerLabel(self.provider), response);
        self.clearDraft();
    }

    fn applyPersisted(self: *AppState, persisted: PersistedState) !void {
        if (persisted.projects.len == 0) {
            try self.seedDefaultState();
            return;
        }

        self.provider = persisted.provider;
        self.harness = persisted.harness;

        for (persisted.projects) |project| {
            try self.projects.append(self.allocator, .{
                .label = try self.dupeZ(project.label),
                .path = try self.dupeZ(project.path),
                .unread_count = project.unread_count,
            });
        }

        for (persisted.messages) |message| {
            try self.messages.append(self.allocator, .{
                .role = message.role,
                .author = try self.dupeZ(message.author),
                .body = try self.dupeZ(message.body),
            });
        }

        self.selected_project_index = @min(persisted.selected_project_index, self.projects.items.len - 1);
        self.next_project_number = self.projects.items.len + 1;

        if (persisted.messages.len == 0) {
            try self.appendMessage(.assistant, providerLabel(self.provider), "Pick a project from the left rail, choose a provider and harness, then start a chat workflow here.");
        }

        self.setDraft(persisted.draft);
        self.dirty = false;
    }

    fn seedDefaultState(self: *AppState) !void {
        try self.addProject("Marketing Site", "~/work/marketing-site", 2);
        try self.addProject("Verde Native", "~/development/blinkx-projects/editor-ts", 0);
        try self.addProject("Docs Rewrite", "~/work/docs-rewrite", 1);

        try self.appendMessage(.system, "Workspace", "Native shell prototype active. Canvas and code tabs are intentionally omitted in this first pass.");
        try self.appendMessage(.assistant, "OpenCode", "Pick a project from the left rail, choose a provider and harness, then start a chat workflow here.");
        try self.appendMessage(.user, "You", "Let us start with the native chat shell and keep the rest of the workbench out of scope.");

        self.setDraft("Sketch the app shell with a simple left rail, project add button, and a chat-first layout.");
        self.dirty = true;
    }

    fn currentProject(self: *const AppState) *const Project {
        return &self.projects.items[self.selected_project_index];
    }

    fn currentDraft(self: *const AppState) []const u8 {
        const slice = self.draft_storage[0..];
        return std.mem.sliceTo(slice, 0);
    }

    fn draftBuffer(self: *AppState) [:0]u8 {
        return self.draft_storage[0 .. self.draft_storage.len - 1 :0];
    }

    fn setDraft(self: *AppState, value: []const u8) void {
        @memset(&self.draft_storage, 0);
        const len = @min(value.len, DRAFT_CAPACITY - 1);
        @memcpy(self.draft_storage[0..len], value[0..len]);
        self.markDirty();
    }

    fn clearDraft(self: *AppState) void {
        self.draft_storage[0] = 0;
        self.markDirty();
    }

    fn markDirty(self: *AppState) void {
        self.dirty = true;
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
        for (self.projects.items) |project| {
            self.allocator.free(project.label);
            self.allocator.free(project.path);
        }
        self.projects.deinit(self.allocator);

        for (self.messages.items) |message| {
            self.allocator.free(message.author);
            self.allocator.free(message.body);
        }
        self.messages.deinit(self.allocator);
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
            // Wayland can emit close-request signals during early window lifecycle.
            // Only a real SDL quit event should tear down the native shell.
            .quit => {
                log.err("received SDL quit event", .{});
                return false;
            },
            .window_close_requested => {
                log.err("received SDL window_close_requested", .{});
            },
            .window_destroyed => {
                log.err("received SDL window_destroyed", .{});
            },
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

    zgui.textColored(COLOR_WHITE, "Projects", .{});
    zgui.sameLine(.{ .spacing = width - 96.0 });
    if (zgui.button("+", .{ .w = 28.0, .h = 28.0 })) {
        state.addProjectFromDraft() catch |err| {
            log.err("failed to add project: {s}", .{@errorName(err)});
        };
    }

    zgui.separator();
    zgui.textColored(COLOR_TEXT_MUTED, "Verde", .{});
    zgui.textWrapped("A compact native rail for project switching. The desktop shell starts here, not with the browser canvas.", .{});
    zgui.spacing();

    for (state.projects.items, 0..) |project, index| {
        const is_selected = state.selected_project_index == index;
        if (is_selected) {
            zgui.pushStyleColor4f(.{ .idx = .header, .c = darken(COLOR_GREEN, 0.10) });
            zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = COLOR_GREEN });
            zgui.pushStyleColor4f(.{ .idx = .header_active, .c = lighten(COLOR_GREEN, 0.12) });
        }

        if (zgui.selectable(project.label, .{
            .selected = is_selected,
            .w = width - 20.0,
            .h = 44.0,
        })) {
            state.selected_project_index = index;
            state.markDirty();
        }

        if (is_selected) {
            zgui.popStyleColor(.{ .count = 3 });
        }

        zgui.textColored(COLOR_TEXT_SUBTLE, "{s}", .{project.path});
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

    renderWorkspaceHeader(state);
    zgui.separator();

    const content = zgui.getContentRegionAvail();
    const transcript_height = @max(content[1] - 164.0, 180.0);
    renderTranscript(state, width - 24.0, transcript_height);
    renderComposer(state, width - 24.0, content[1] - transcript_height - 8.0);
}

fn renderWorkspaceHeader(state: *AppState) void {
    const project = state.currentProject();
    zgui.textColored(COLOR_WHITE, "{s}", .{project.label});
    zgui.textColored(COLOR_TEXT_MUTED, "{s}", .{project.path});

    if (zgui.comboFromEnum("Provider", &state.provider)) {
        state.markDirty();
    }
    zgui.sameLine(.{ .spacing = 18.0 });
    if (zgui.comboFromEnum("Harness", &state.harness)) {
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

    for (state.messages.items, 0..) |message, index| {
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
