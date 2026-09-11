import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar.js';
import { TabBar } from './components/TabBar.js';
import { OfflineBar, Toast } from './components/Toast.js';
import { connectStream, disconnectStream } from './lib/realtime.js';
import { store, useApp } from './lib/store.js';
import { Claim } from './screens/Claim.js';
import { ClaimLink } from './screens/ClaimLink.js';
import { NewGroup } from './screens/NewGroup.js';
import { SendLink } from './screens/SendLink.js';
import { Home } from './screens/Home.js';
import { Me } from './screens/Me.js';
import { Pay } from './screens/Pay.js';
import { People } from './screens/People.js';
import { Profile } from './screens/Profile.js';
import { Scan } from './screens/Scan.js';
import { Settings } from './screens/Settings.js';
import { Split } from './screens/Split.js';
import { Thread } from './screens/Thread.js';
import { Welcome } from './screens/Welcome.js';

export function App() {
  const phase = useApp((state) => state.phase);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { void store.load(); }, []);

  useEffect(() => {
    const online = () => { store.setOnline(true); void store.refreshMe(); };
    const offline = () => store.setOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready') { disconnectStream(); return; }
    connectStream();
    return disconnectStream;
  }, [phase]);

  // Signed-out people can still open a shared link; everything else waits.
  useEffect(() => {
    if (phase !== 'signed-out') return;
    // A money link and a profile link both have to work before signing in —
    // that is the whole point of them.
    const open = ['/welcome', '/claim'].includes(location.pathname) ||
      location.pathname.startsWith('/c/') || isProfileLink(location.pathname);
    if (!open) navigate('/welcome', { replace: true });
  }, [phase, location.pathname, navigate]);

  if (phase === 'loading') {
    return <div className="boot"><span className="spinner spinner-lg" aria-label="Loading" /></div>;
  }

  // The sidebar only exists on wide screens, and only once you are signed in.
  const wide = phase === 'ready' && !['/welcome', '/claim'].includes(location.pathname) &&
    !location.pathname.startsWith('/c/');

  return (
    <>
      <OfflineBar />
      {wide && <Sidebar />}
      <main className="pane">
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/claim" element={<Claim />} />
        <Route path="/" element={phase === 'ready' ? <Home /> : <Navigate to="/welcome" replace />} />
        <Route path="/t/:handle" element={<Thread />} />
        <Route path="/pay/:handle" element={<Pay mode="pay" />} />
        <Route path="/request/:handle" element={<Pay mode="request" />} />
        <Route path="/people" element={<People />} />
        <Route path="/split" element={<Split />} />
        <Route path="/groups/new" element={<NewGroup />} />
        <Route path="/link" element={<SendLink />} />
        <Route path="/c/:id" element={<ClaimLink />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/me" element={<Me />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/:handle" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </main>
      <TabBar />
      <Toast />
    </>
  );
}

function isProfileLink(pathname: string): boolean {
  return /^\/@?[a-zA-Z0-9_]{3,20}$/.test(pathname);
}
