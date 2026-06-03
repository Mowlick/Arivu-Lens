import { useState } from "react";

// Check if running inside the Tauri native desktop wrapper
export const isTauriEnvironment = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const useNativeFS = () => {
  const [nativePath, setNativePath] = useState<string | null>(null);
  const [isTauri] = useState<boolean>(isTauriEnvironment());

  /**
   * Invokes the Tauri native operating system folder selector.
   * Falls back gracefully to returning null if running in standard browser.
   */
  const pickDirectory = async (): Promise<string | null> => {
    if (!isTauri) {
      console.log("Running in standard browser; native file system picker is unavailable.");
      return null;
    }

    try {
      // Dynamic import prevents bundler import errors in non-Tauri standalone browser instances
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Arivu-Lens: Select Codebase Directory"
      });

      if (selected && typeof selected === "string") {
        setNativePath(selected);
        return selected;
      }
    } catch (err) {
      console.error("Failed to execute native Tauri directory selector dialog: ", err);
    }
    return null;
  };

  return {
    isTauri,
    nativePath,
    pickDirectory
  };
};
