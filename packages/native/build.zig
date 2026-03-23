const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const zgui = b.dependency("zgui", .{
        .backend = .sdl3_opengl3,
        .shared = false,
    });
    const zsdl = b.dependency("zsdl", .{});

    const exe = b.addExecutable(.{
        .name = "native",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "zgui", .module = zgui.module("root") },
                .{ .name = "zsdl3", .module = zsdl.module("zsdl3") },
            },
        }),
    });
    exe.linkLibrary(zgui.artifact("imgui"));
    exe.linkSystemLibrary("SDL3");
    exe.linkLibC();
    exe.root_module.addIncludePath(b.path("src/vendor"));
    exe.addCSourceFile(.{
        .file = b.path("src/vendor/stb_image_impl.c"),
        .flags = &.{},
    });
    switch (target.result.os.tag) {
        .linux => exe.linkSystemLibrary("GL"),
        .windows => exe.linkSystemLibrary("opengl32"),
        .macos => exe.linkFramework("OpenGL"),
        else => {},
    }

    switch (target.result.os.tag) {
        .linux => exe.root_module.addRPathSpecial("$ORIGIN"),
        .macos => exe.root_module.addRPathSpecial("@executable_path"),
        else => {},
    }

    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the application");
    run_step.dependOn(&run_cmd.step);

    const test_step = b.step("test", "Run unit tests");
    const exe_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    exe_tests.root_module.addIncludePath(b.path("src/vendor"));
    exe_tests.addCSourceFile(.{
        .file = b.path("src/vendor/stb_image_impl.c"),
        .flags = &.{},
    });
    exe_tests.linkLibC();
    test_step.dependOn(&b.addRunArtifact(exe_tests).step);

    const fmt_check = b.addFmt(.{ .paths = &.{ "src", "build.zig", "build.zig.zon" } });
    test_step.dependOn(&fmt_check.step);
}
