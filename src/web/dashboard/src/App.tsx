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
import { SystemsPage } from './components/pages/SystemsPage';
import { UsagePage } from './components/pages/UsagePage';
import { HeartbeatsPage } from './components/pages/HeartbeatsPage';
import { RunsPage } from './components/pages/RunsPage';
import { EventsPage } from './components/pages/EventsPage';

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
        <Route path="/team" element={<TeamPage />} />
        <Route path="/systems" element={<SystemsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/heartbeats" element={<HeartbeatsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/events" element={<EventsPage />} />
      </Routes>
    </AppShell>
  );
}
