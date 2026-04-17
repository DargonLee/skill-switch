import { useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { MyLibraryPage } from "./pages/MyLibraryPage";
import { RepoBrowsePage } from "./pages/RepoBrowsePage";
import { CreatePage } from "./pages/CreatePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppProvider } from "./context/AppContext";
import { SkillProvider } from "./context/SkillContext";
import { ProjectProvider } from "./context/ProjectContext";
import { SettingsProvider } from "./context/SettingsContext";
import { SourceProvider } from "./context/SourceContext";
import { UpdaterProvider } from "./context/UpdaterContext";
import { ToastProvider } from "./components/ui/Toast";
import { ToastContainer } from "./components/ui/ToastContainer";
import { UpdateNotification } from "./components/ui/UpdateNotification";
import "./App.css";

export type PageId = "my-library" | "repo-browse" | "create" | "settings";
export type LibraryTab = "self-created" | "third-party" | "external";

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("my-library");
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [activeLibraryTab, setActiveLibraryTab] = useState<LibraryTab>("self-created");

  const navigateToRepo = (repoId: string) => {
    setActiveRepoId(repoId);
    setActivePage("repo-browse");
  };

  const navigateToLibraryTab = (tab: LibraryTab) => {
    setActiveLibraryTab(tab);
    setActivePage("my-library");
  };

  const renderPage = () => {
    switch (activePage) {
      case "my-library": return <MyLibraryPage onNavigate={setActivePage} activeLibraryTab={activeLibraryTab} />;
      case "repo-browse": return <RepoBrowsePage repoId={activeRepoId ?? ""} />;
      case "create":    return <CreatePage onNavigate={setActivePage} />;
      case "settings":  return <SettingsPage />;
    }
  };

  return (
    <AppProvider>
      <SettingsProvider>
        <ToastProvider>
          <SourceProvider>
            <SkillProvider>
              <ProjectProvider>
                <UpdaterProvider>
                  <AppShell
                    activePage={activePage}
                    activeRepoId={activeRepoId}
                    activeLibraryTab={activeLibraryTab}
                    onNavigate={setActivePage}
                    onNavigateRepo={navigateToRepo}
                    onNavigateLibraryTab={navigateToLibraryTab}
                  >
                    {renderPage()}
                  </AppShell>
                  <ToastContainer />
                  <UpdateNotification />
                </UpdaterProvider>
              </ProjectProvider>
            </SkillProvider>
          </SourceProvider>
        </ToastProvider>
      </SettingsProvider>
    </AppProvider>
  );
}