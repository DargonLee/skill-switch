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

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("my-library");
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);

  const navigateToRepo = (repoId: string) => {
    setActiveRepoId(repoId);
    setActivePage("repo-browse");
  };

  const renderPage = () => {
    switch (activePage) {
      case "my-library": return <MyLibraryPage />;
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
                    onNavigate={setActivePage}
                    onNavigateRepo={navigateToRepo}
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