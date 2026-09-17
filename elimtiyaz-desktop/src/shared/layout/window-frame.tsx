import { Maximize2, Minimize2, Square, X, Expand } from "lucide-react";
import { useEffect, useState } from "react";

interface DesktopWindowApi {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  isMaximized: () => Promise<boolean>;
  toggleFullscreen: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  close: () => Promise<void>;
}

function desktopApi(): DesktopWindowApi | undefined {
  return (window as Window & { elImtiyazDesktop?: { window: DesktopWindowApi } }).elImtiyazDesktop?.window;
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    void api.isMaximized().then(setMaximized);
    void api.isFullscreen().then(setFullscreen);
  }, []);

  const minimize = () => void desktopApi()?.minimize();
  const toggleMaximize = async () => {
    const api = desktopApi();
    if (!api) return;
    setMaximized(await api.toggleMaximize());
  };
  const toggleFullscreen = async () => {
    const api = desktopApi();
    if (!api) return;
    setFullscreen(await api.toggleFullscreen());
  };
  const close = () => void desktopApi()?.close();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden border border-border/80 bg-background text-foreground shadow-2xl">
      <header
        className="flex h-10 shrink-0 items-center border-b border-border/70 bg-card/95 px-3 select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
          EL-IMTIYAZ · DESKTOP
        </div>
        <div
          className="flex h-full items-center gap-0.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button type="button" aria-label="Minimize window" title="Minimize" onClick={minimize} className="flex h-7 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore" : "Maximize"} onClick={toggleMaximize} className="flex h-7 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {maximized ? <Square className="h-3 w-3" strokeWidth={1.8} /> : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
          </button>
          <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen} className="flex h-7 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <Expand className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Close window" title="Close" onClick={close} className="flex h-7 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
