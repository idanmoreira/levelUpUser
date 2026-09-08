import { expect, test } from "@playwright/test";

type LiquidGlassRenderer = {
  _rafId?: number;
  captureSnapshot: () => Promise<boolean>;
  lenses: Array<{
    options: {
      reveal: "fade" | "none";
      specular: boolean;
    };
  }>;
};

type LiquidGlassWindow = Window & {
  __liquidGLRenderer__?: LiquidGlassRenderer & {
    __testCaptureCount?: number;
  };
};

const routes = [
  { heading: "Ideas, products, and active builds.", path: "/projects" },
  { heading: "Privacy Policy", path: "/privacy" },
  { heading: "Terms of Service", path: "/terms" },
  { heading: "Page not found", path: "/missing-page" },
  { heading: "LevelUp User", path: "/" },
] as const;

function recordRuntimeErrors(errors: string[]) {
  return (message: { text(): string; type(): string }) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  };
}

test("keeps one animated glass lens and refreshes it on every route", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", recordRuntimeErrors(runtimeErrors));
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");

  const navigation = page.locator("#levelup-liquid-navigation");
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveCSS("opacity", "1", { timeout: 3_000 });
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const renderer = (window as LiquidGlassWindow).__liquidGLRenderer__;
        return {
          canvasCount: document.querySelectorAll("body > canvas[data-liquid-ignore]")
            .length,
          lensCount: renderer?.lenses.length ?? 0,
          rendering: Boolean(renderer?._rafId),
        };
      }),
    )
    .toEqual({ canvasCount: 1, lensCount: 1, rendering: true });

  await page.evaluate(() => {
    const renderer = (window as LiquidGlassWindow).__liquidGLRenderer__;

    if (!renderer) {
      throw new Error("liquidGL renderer was not initialized");
    }

    const captureSnapshot = renderer.captureSnapshot.bind(renderer);
    renderer.__testCaptureCount = 0;
    renderer.captureSnapshot = async () => {
      renderer.__testCaptureCount = (renderer.__testCaptureCount ?? 0) + 1;
      return captureSnapshot();
    };
  });

  let previousCaptureCount = 0;

  for (const route of routes) {
    await page.evaluate((path) => {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, route.path);

    await expect(page).toHaveURL(route.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      route.heading,
    );
    await expect(navigation).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as LiquidGlassWindow).__liquidGLRenderer__
              ?.__testCaptureCount ?? 0,
        ),
      )
      .toBeGreaterThan(previousCaptureCount);

    previousCaptureCount = await page.evaluate(
      () =>
        (window as LiquidGlassWindow).__liquidGLRenderer__
          ?.__testCaptureCount ?? 0,
    );

    const rendererState = await page.evaluate(() => {
      const renderer = (window as LiquidGlassWindow).__liquidGLRenderer__;
      return {
        canvasCount: document.querySelectorAll("body > canvas[data-liquid-ignore]")
          .length,
        lensCount: renderer?.lenses.length ?? 0,
      };
    });

    expect(rendererState).toEqual({ canvasCount: 1, lensCount: 1 });
  }

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL("/projects");
  expect(runtimeErrors).toEqual([]);
});

test("disables reveal and specular animation when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("#levelup-liquid-navigation")).toHaveCSS(
    "opacity",
    "1",
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        const lens = (window as LiquidGlassWindow).__liquidGLRenderer__?.lenses[0];
        return lens
          ? { reveal: lens.options.reveal, specular: lens.options.specular }
          : null;
      }),
    )
    .toEqual({ reveal: "none", specular: false });
});

test("keeps navigation usable when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      contextId: string,
      ...args: unknown[]
    ) {
      if (contextId.startsWith("webgl") || contextId === "experimental-webgl") {
        return null;
      }

      return Reflect.apply(getContext, this, [contextId, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto("/");

  const navigation = page.locator("#levelup-liquid-navigation");
  await expect(navigation).toHaveCSS("backdrop-filter", "blur(12px)");
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Ideas, products, and active builds.",
  );
});
