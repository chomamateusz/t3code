import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => process.env,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["T3CODE_RELEASE_REPOSITORY", "T3CODE_ALLOWED_UPDATE_REPOSITORY"])(
  "bakes %s into the desktop main bundle used by startup recovery",
  async (key) => {
    vi.stubEnv("T3CODE_RELEASE_REPOSITORY", "");
    vi.stubEnv("T3CODE_ALLOWED_UPDATE_REPOSITORY", "");
    vi.stubEnv(key, " Chomamateusz/T3Code ");
    const { default: config } = await import("./vite.config.ts");
    expect(config).toMatchObject({
      pack: expect.arrayContaining([
        expect.objectContaining({
          entry: ["src/main.ts"],
          define: expect.objectContaining({
            __T3CODE_BUILD_RELEASE_REPOSITORY__: '"chomamateusz/t3code"',
          }),
        }),
      ]),
    });
  },
);
