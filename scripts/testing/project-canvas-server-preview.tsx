// The project canvas on a disposable server, inside the app's store as the project view will hold it: ?project=<id>
// names the project, ?skin= the skin (daylight by default) and ?lang= the language (English by default). The store's
// ref is window.canvasStore, so a test can read where opening a chat took the app.
import { createRoot } from "react-dom/client";
import { ServerProjectCanvas } from "../../src/components/project-canvas/ServerProjectCanvas";
import { loadLocale } from "../../src/lib/i18n";
import { languageChoice, setLanguageChoice } from "../../src/lib/language-preference";
import { StoreProvider } from "../../src/state/store";
import { useStoreRef } from "../../src/state/store-ref";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.skin = params.get("skin") ?? "daylight";
if (languageChoice() === null) setLanguageChoice("en");

function ExposeStore() {
  Object.assign(window, { canvasStore: useStoreRef() });
  return null;
}

void loadLocale(params.get("lang") ?? "en").then(() => createRoot(document.getElementById("root")!).render(
  <StoreProvider>
    <ExposeStore />
    <div style={{ height: "100vh" }}>
      <ServerProjectCanvas projectId={params.get("project") ?? ""} />
    </div>
  </StoreProvider>,
));
