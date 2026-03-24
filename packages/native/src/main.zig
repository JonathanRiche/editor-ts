//! Minimal native shell prototype for the desktop chat workflow.

const std = @import("std");

const sdl = @import("zsdl3");
const zgui = @import("zgui");

const ai_harness = @import("harness.zig");
const ReasoningEffort = ai_harness.ReasoningEffort;
const app_config = @import("config.zig");
const chat_threads = @import("chat/threads.zig");
const keybinds = @import("keybinds.zig");
const stb_image = @import("stb_image.zig");
const ui_layout = @import("ui/layout.zig");
const ui_theme = @import("ui/theme.zig");
const sidebar_components = @import("ui/sidebar_components.zig");
const AppState = @import("state.zig").AppState;
const Storage = @import("state.zig").Storage;

const DEFAULT_FONT_SIZE: f32 = ui_theme.DEFAULT_FONT_SIZE;

pub const COLOR_GREEN = ui_theme.COLOR_GREEN;
pub const COLOR_SECONDARY_GREEN = ui_theme.COLOR_SECONDARY_GREEN;
pub const COLOR_YELLOW = ui_theme.COLOR_YELLOW;
pub const COLOR_NAV_CHAT_BG = ui_theme.COLOR_NAV_CHAT_BG;
const COLOR_BLACK = COLOR_NAV_CHAT_BG;
pub const COLOR_WHITE = ui_theme.COLOR_WHITE;
pub const COLOR_PANEL = ui_theme.COLOR_PANEL;
pub const COLOR_PANEL_ALT = ui_theme.COLOR_PANEL_ALT;
pub const COLOR_PANEL_MUTED = ui_theme.COLOR_PANEL_MUTED;
pub const COLOR_TEXT_MUTED = ui_theme.COLOR_TEXT_MUTED;
pub const COLOR_TEXT_SUBTLE = ui_theme.COLOR_TEXT_SUBTLE;
pub const COLOR_DIFF_ADD = ui_theme.COLOR_DIFF_ADD;
pub const COLOR_DIFF_REMOVE = ui_theme.COLOR_DIFF_REMOVE;
pub const COLOR_ACCENT_DIM = ui_theme.COLOR_ACCENT_DIM;
pub const TRANSCRIPT_BUBBLE_PADDING_X = ui_theme.TRANSCRIPT_BUBBLE_PADDING_X;
pub const TRANSCRIPT_BUBBLE_PADDING_Y = ui_theme.TRANSCRIPT_BUBBLE_PADDING_Y;
pub const TRANSCRIPT_BUBBLE_ROUNDING = ui_theme.TRANSCRIPT_BUBBLE_ROUNDING;
const RESPONSIVE_BASE_FONT_SIZE: f32 = ui_theme.RESPONSIVE_BASE_FONT_SIZE;

const CAL_SANS_BYTES = @embedFile("assets/fonts/CalSans-Regular.ttf");
const DEFAULT_WINDOW_WIDTH: c_int = 1360;
const DEFAULT_WINDOW_HEIGHT: c_int = 860;
const MIN_WINDOW_WIDTH: c_int = 960;
const MIN_WINDOW_HEIGHT: c_int = 680;
const MAX_WINDOW_WIDTH: c_int = 1520;
const MAX_WINDOW_HEIGHT: c_int = 980;

//for hex in fornt of each 2 chars add 0x
pub const PERSISTED_DIFF_MARKER = "EDITORTS_DIFF_V1\n";
pub const IMAGE_MODAL_ID: [:0]const u8 = "AttachmentPreviewModal";
pub const PROJECT_RENAME_MODAL_ID: [:0]const u8 = "ProjectRenameModal";
var heading_font: ?zgui.Font = null;
var heading_font_size: f32 = DEFAULT_FONT_SIZE * 1.28;

extern fn SDL_GetPrimaryDisplay() sdl.DisplayId;
extern fn SDL_GetDisplayUsableBounds(display_id: sdl.DisplayId, rect: *SdlRect) bool;
extern fn SDL_WaitEventTimeout(event: *sdl.Event, timeoutMS: c_int) bool;
extern fn SDL_GetWindowSizeInPixels(window: *sdl.Window, w: ?*c_int, h: ?*c_int) bool;
extern fn SDL_GetWindowDisplayScale(window: *sdl.Window) f32;
extern fn SDL_SetWindowPosition(window: *sdl.Window, x: c_int, y: c_int) bool;

const SdlRect = extern struct {
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
};

pub const SIDEBAR_VISIBLE_THREAD_LIMIT: usize = 6;
const CLIPBOARD_IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_THREAD_MESSAGES: usize = 24;
const ACTIVE_WAIT_TIMEOUT_MS: c_int = 16;
const IDLE_WAIT_TIMEOUT_MS: c_int = 50;

pub const ChangedFileEntry = struct {
    path: []const u8,
    additions: i64,
    deletions: i64,
    patch: ?[]const u8 = null,
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

pub fn main() !void {
    var gpa_state: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa_state.deinit();
    const allocator = gpa_state.allocator();

    try sdl.setAppMetadata("verde Native", "0.0.0", "com.verde.native");
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
        "verde",
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
    ui_theme.installFonts(CAL_SANS_BYTES[0..CAL_SANS_BYTES.len], ui_config.font_size);
    heading_font = ui_theme.heading_font;
    heading_font_size = ui_theme.heading_font_size;
    zgui.backend.init(window, gl_context);
    defer zgui.backend.deinit();

    var ui_scale = currentWindowDisplayScale(window);
    ui_theme.applyTheme(ui_scale);

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
            ui_theme.applyTheme(ui_scale);
        }

        zgui.backend.newFrame(@intCast(fb_width), @intCast(fb_height));
        ui_layout.renderRoot(@This(), &state, @floatFromInt(fb_width), @floatFromInt(fb_height));
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

    if (!sdl.pollEvent(&event)) {
        if (!SDL_WaitEventTimeout(&event, eventWaitTimeoutMs(state))) {
            return true;
        }
        if (!handleEvent(state, keyboard, &event)) return false;
    } else {
        if (!handleEvent(state, keyboard, &event)) return false;
    }

    while (sdl.pollEvent(&event)) {
        if (!handleEvent(state, keyboard, &event)) return false;
    }

    return true;
}

fn eventWaitTimeoutMs(state: *AppState) c_int {
    return if (state.hasPendingStream() or state.isPickerPending()) ACTIVE_WAIT_TIMEOUT_MS else IDLE_WAIT_TIMEOUT_MS;
}

fn handleEvent(state: *AppState, keyboard: *keybinds.NativeKeyboardConfig, event: *sdl.Event) bool {
    _ = zgui.backend.processEvent(event);
    switch (event.type) {
        .quit => return false,
        .key_down => {
            if (shouldPasteClipboardImage(state, &event.key)) {
                state.attachClipboardImageToCurrentDraft();
                return true;
            }
            const action = keyboard.actionForEvent(&event.key) orelse return true;
            handleKeyboardAction(state, keyboard, action);
        },
        else => {},
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
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ 0.0, 0.0 } });
    zgui.pushStyleVar2f(.{ .idx = .item_spacing, .v = .{ 0.0, 0.0 } });
    defer zgui.popStyleVar(.{ .count = 2 });
    zgui.setCursorPos(.{ 0.0, 0.0 });
    sidebar_components.renderSidebar(state, sidebar_width, 0.0);
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
    zgui.pushStyleColor4f(.{ .idx = .button, .c = ui_theme.rgba(46, 48, 56, 220) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = ui_theme.rgba(68, 70, 79, 240) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = ui_theme.rgba(90, 92, 102, 255) });
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
        zgui.popStyleVar(.{ .count = 2 });
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
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = ui_theme.lighten(COLOR_PANEL_ALT, 0.08) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = ui_theme.lighten(COLOR_PANEL_ALT, 0.14) });
    if (zgui.button("Cancel", .{ .w = button_width, .h = scaledUi(34.0) })) {
        state.cancelProjectRename();
        zgui.closeCurrentPopup();
        zgui.popStyleColor(.{ .count = 3 });
        return;
    }
    zgui.popStyleColor(.{ .count = 3 });

    zgui.sameLine(.{ .spacing = scaledUi(10.0) });
    zgui.pushStyleColor4f(.{ .idx = .button, .c = COLOR_SECONDARY_GREEN });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = ui_theme.lighten(COLOR_SECONDARY_GREEN, 0.10) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = ui_theme.darken(COLOR_SECONDARY_GREEN, 0.10) });
    if (zgui.button("Rename", .{ .w = button_width, .h = scaledUi(34.0) })) {
        state.finishProjectRename();
        zgui.closeCurrentPopup();
        zgui.popStyleColor(.{ .count = 3 });
        return;
    }
    zgui.popStyleColor(.{ .count = 3 });
}

fn renderChatWorkspace(state: *AppState, width: f32, height: f32) void {
    _ = width;
    _ = height;
    const overscan = scaledUi(12.0);
    zgui.setCursorPos(.{
        @max(0.0, zgui.getCursorPosX() - overscan),
        0.0,
    });
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = 0.0 });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ scaledUi(30.0), scaledUi(18.0) } });
    defer zgui.popStyleVar(.{ .count = 2 });
    _ = zgui.beginChild("ChatWorkspace", .{
        .w = zgui.getContentRegionAvail()[0] + overscan,
        .h = zgui.getContentRegionAvail()[1] + overscan,
        .child_flags = .{ .border = false },
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
    const thread = state.currentThread();
    zgui.dummy(.{ .w = 0.0, .h = scaledUi(10.0) });
    zgui.textColored(COLOR_WHITE, "{s}", .{if (thread.committed) thread.title else "New chat"});
    zgui.dummy(.{ .w = 0.0, .h = scaledUi(10.0) });
    zgui.separator();
    zgui.dummy(.{ .w = 0.0, .h = scaledUi(10.0) });
}

fn renderTranscript(state: *AppState, width: f32, height: f32) void {
    _ = zgui.beginChild("Transcript", .{
        .w = width,
        .h = height,
        .child_flags = .{ .border = false },
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
        zgui.pushStyleColor4f(.{ .idx = .button, .c = ui_theme.rgba(52, 54, 60, 255) });
        zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = ui_theme.rgba(64, 66, 74, 255) });
        zgui.pushStyleColor4f(.{ .idx = .button_active, .c = ui_theme.rgba(44, 46, 52, 255) });
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
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = ui_theme.rgba(32, 33, 38, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = ui_theme.rgba(58, 60, 68, 255) });
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
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = ui_theme.rgba(28, 29, 34, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = ui_theme.rgba(46, 48, 56, 255) });
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
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = ui_theme.rgba(32, 33, 38, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = ui_theme.rgba(58, 60, 68, 255) });
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
    zgui.pushStyleColor4f(.{ .idx = .button, .c = ui_theme.rgba(52, 54, 60, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = ui_theme.rgba(62, 64, 72, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = ui_theme.rgba(68, 70, 78, 255) });
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
    zgui.pushStyleColor4f(.{ .idx = .child_bg, .c = ui_theme.rgba(24, 24, 24, 255) });
    zgui.pushStyleColor4f(.{ .idx = .border, .c = ui_theme.rgba(52, 52, 52, 255) });
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
    zgui.pushStyleColor4f(.{ .idx = .button, .c = ui_theme.rgba(52, 54, 61, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_hovered, .c = ui_theme.rgba(74, 76, 84, 255) });
    zgui.pushStyleColor4f(.{ .idx = .button_active, .c = ui_theme.rgba(92, 94, 102, 255) });
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
        .col = zgui.colorConvertFloat4ToU32(ui_theme.rgba(42, 43, 50, 255)),
        .rounding = scaledUi(12.0),
    });
    draw_list.addRect(.{
        .pmin = start,
        .pmax = .{ start[0] + card_width, start[1] + card_height },
        .col = zgui.colorConvertFloat4ToU32(ui_theme.rgba(68, 71, 82, 255)),
        .rounding = scaledUi(12.0),
        .thickness = 1.0,
    });
    draw_list.addRectFilled(.{
        .pmin = .{ start[0] + card_padding, start[1] + card_padding },
        .pmax = .{ start[0] + card_padding + preview_width, start[1] + card_padding + preview_height },
        .col = zgui.colorConvertFloat4ToU32(ui_theme.rgba(24, 25, 31, 255)),
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
                .col = zgui.colorConvertFloat4ToU32(ui_theme.rgba(120, 124, 136, 180)),
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

pub fn scaledImageSize(width: i32, height: i32, max_width: f32, max_height: f32) [2]f32 {
    if (width <= 0 or height <= 0) return .{ max_width, max_height };
    const width_f: f32 = @floatFromInt(width);
    const height_f: f32 = @floatFromInt(height);
    const scale = @min(max_width / width_f, max_height / height_f);
    return .{ width_f * scale, height_f * scale };
}

pub fn textureRefFromGlId(texture_id: c_uint) zgui.TextureRef {
    return .{
        .tex_data = null,
        .tex_id = @enumFromInt(@as(u64, texture_id)),
    };
}

pub fn formatByteSize(buffer: *[32:0]u8, size: usize) [:0]const u8 {
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
            .background = ui_theme.rgba(18, 62, 42, 255),
            .border = ui_theme.rgba(28, 140, 80, 180),
            .author = ui_theme.rgba(130, 255, 180, 255),
        },
        .assistant => .{
            .background = ui_theme.rgba(38, 39, 44, 255),
            .border = ui_theme.rgba(62, 64, 72, 255),
            .author = ui_theme.rgba(180, 185, 200, 255),
        },
        .system => .{
            .background = ui_theme.rgba(52, 42, 18, 255),
            .border = ui_theme.rgba(140, 112, 28, 180),
            .author = ui_theme.rgba(255, 230, 150, 255),
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
    const composer_bg = ui_theme.rgba(30, 31, 36, 255);
    const composer_rounding = scaledUi(18.0);
    state.composer_focused = false;
    zgui.pushStyleVar1f(.{ .idx = .child_rounding, .v = composer_rounding });
    zgui.pushStyleVar2f(.{ .idx = .window_padding, .v = .{ scaledUi(18.0), scaledUi(12.0) } });
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
            ui_theme.rgba(124, 221, 94, 140)
        else
            ui_theme.rgba(58, 62, 78, 255);
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
        fg_draw_list.addText(hint_pos, zgui.colorConvertFloat4ToU32(ui_theme.rgba(100, 102, 115, 255)), "Ask anything, or use / to show available commands", .{});
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
            ui_theme.rgba(80, 72, 24, 255)
        else if (hovered)
            ui_theme.lighten(COLOR_SECONDARY_GREEN, 0.12)
        else
            COLOR_SECONDARY_GREEN;
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

pub fn renderComposerPickers(state: *AppState) void {
    const thread = state.currentThreadMutable();

    // Subtle combo styling — transparent background, no visual frame

    const transparent = ui_theme.rgba(0, 0, 0, 0);
    const picker_text_color = ui_theme.rgba(160, 164, 180, 255);
    const picker_hover_bg = ui_theme.rgba(50, 52, 60, 255);
    const separator_color = ui_theme.rgba(60, 62, 72, 255);

    zgui.pushStyleVar1f(.{ .idx = .frame_rounding, .v = 8.0 });
    zgui.pushStyleVar2f(.{ .idx = .frame_padding, .v = .{ 8.0, 6.0 } });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg, .c = transparent });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_hovered, .c = picker_hover_bg });
    zgui.pushStyleColor4f(.{ .idx = .frame_bg_active, .c = picker_hover_bg });
    zgui.pushStyleColor4f(.{ .idx = .popup_bg, .c = ui_theme.rgba(26, 27, 32, 250) });
    zgui.pushStyleColor4f(.{ .idx = .header, .c = ui_theme.rgba(42, 44, 52, 255) });
    zgui.pushStyleColor4f(.{ .idx = .header_hovered, .c = ui_theme.rgba(52, 54, 64, 255) });
    zgui.pushStyleColor4f(.{ .idx = .header_active, .c = ui_theme.rgba(58, 60, 70, 255) });
    zgui.pushStyleColor4f(.{ .idx = .text, .c = picker_text_color });
    defer {
        zgui.popStyleColor(.{ .count = 8 });
        zgui.popStyleVar(.{ .count = 2 });
    }

    // --- Model picker (combines provider context) ---
    const model_preview = chat_threads.selectedModelLabel(ModelOption, thread, OPENCODE_MODEL_OPTIONS[0..], CODEX_MODEL_OPTIONS[0..]);
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
        zgui.popStyleVar(.{ .count = 1 });
        zgui.popStyleColor(.{ .count = 1 });
        inline for (@typeInfo(Provider).@"enum".fields) |field| {
            const candidate: Provider = @enumFromInt(field.value);
            var row_buf = std.mem.zeroes([48:0]u8);
            const row_label = comboRowLabel(&row_buf, chat_threads.providerLabel(candidate), candidate == thread.provider);
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
        for (chat_threads.modelOptions(ModelOption, thread.provider, OPENCODE_MODEL_OPTIONS[0..], CODEX_MODEL_OPTIONS[0..])) |option| {
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
        const reasoning_preview = chat_threads.selectedReasoningLabel(ReasoningOption, thread, CODEX_REASONING_OPTIONS[0..]);
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
        const access_label: [:0]const u8 = chat_threads.accessModeLabel(thread.access_mode);
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

pub fn isSendPending(state: *AppState) bool {
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

fn comboRowLabel(buffer: []u8, label: []const u8, selected: bool) [:0]const u8 {
    return std.fmt.bufPrintZ(buffer, "{s} {s}", .{ if (selected) ">" else " ", label }) catch " row";
}

fn lastMessagePreview(project: *const Project) []const u8 {
    const thread = project.currentThread();
    const message = thread.messages.items[thread.messages.items.len - 1];
    const body = message.body;
    if (body.len <= 44) return body;
    return body[0..44];
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

fn messageBubbleColor(role: ChatRole) [4]f32 {
    return switch (role) {
        .user => ui_theme.darken(COLOR_GREEN, 0.22),
        .assistant => COLOR_PANEL_ALT,
        .system => ui_theme.darken(COLOR_YELLOW, 0.48),
    };
}

extern fn glClearColor(red: f32, green: f32, blue: f32, alpha: f32) void;
extern fn glClear(mask: u32) void;

const GL_COLOR_BUFFER_BIT: u32 = 0x0000_4000;
