import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriEnvironment } from "./useNativeFS";

/**
 * React hook that intercepts operating system native folder drag and drop events,
 * capturing the absolute folder path directly into the application context.
 */
export function useNativeDragAndDrop(onPathValidated: (absolutePath: string) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const isTauri = isTauriEnvironment();

  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | null = null;

    const setupListeners = async () => {
      try {
        const webview = getCurrentWebviewWindow();
        const unsubscribe = await webview.onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragging(true);
          } else if (event.payload.type === "drop") {
            setIsDragging(false);
            const droppedPaths = event.payload.paths;
            if (droppedPaths && droppedPaths.length > 0) {
              onPathValidated(droppedPaths[0]);
            }
          } else if (event.payload.type === "leave") {
            setIsDragging(false);
          }
        });
        unlisten = unsubscribe;
      } catch (err) {
        console.error("Failed to establish Tauri native drag-and-drop listener: ", err);
      }
    };

    setupListeners();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [onPathValidated, isTauri]);

  return { isDragging };
}
