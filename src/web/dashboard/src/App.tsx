import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { MorningPage } from './components/pages/MorningPage';
import { DashboardPage } from './components/pages/DashboardPage';
import { ProfilePage } from './components/pages/ProfilePage';
import { MemoriesPage } from './components/pages/MemoriesPage';
import { SuggestionsPage } from './components/pages/SuggestionsPage';
import { ObservationsPage } from './components/pages/ObservationsPage';
import { ReposPage } from './components/pages/ReposPage';
import { TeamPage } from './components/pages/TeamPage';
import { ProjectsPage } from './components/pages/ProjectsPage';
import { SystemsPage } from './components/pages/SystemsPage';
import { ProjectDetailPage } from './components/pages/ProjectDetailPage';
import { SystemDetailPage } from './components/pages/SystemDetailPage';
import { UsagePage } from './components/pages/UsagePage';
import { JobsPage } from './components/pages/JobsPage';
import { RunsPage } from './components/pages/RunsPage';
import { EventsPage } from './components/pages/EventsPage';
import { DigestsPage } from './components/pages/DigestsPage';
import { GuidePage } from './components/pages/GuidePage';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/morning" replace />} />
        <Route path="/morning" element={<MorningPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/memories" element={<MemoriesPage />} />
        <Route path="/suggestions" element={<SuggestionsPage />} />
        <Route path="/observations" element={<ObservationsPage />} />
        <Route path="/repos" element={<ReposPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/systems" element={<SystemsPage />} />
        <Route path="/systems/:id" element={<SystemDetailPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/digests" element={<DigestsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/emoji-guide" element={<Navigate to="/guide?section=status-line" replace />} />
      </Routes>
    </AppShell>
  );
}
