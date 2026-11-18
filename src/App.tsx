import { HashRouter, Navigate, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Toast } from './components/ui';
import { useNativeBridge } from './lib/native';
import { useDailyTick, useLiveUpdates, useMe, useStore, useTimeZoneSync } from './lib/store';
import type { Account } from './lib/types';
import { AppView, Emergency, Launcher, Locked } from './screens/Apps';
import { SignIn, SignUp, Welcome } from './screens/Auth';
import { ApproveProof, ChildHome, ChildRules, ChildTaskForm, ChildWeek, JoinFamily, LinkChild, ParentHome } from './screens/Family';
import { Home } from './screens/Home';
import { Chat, Messages } from './screens/Messages';
import { AddVerifier, ChooseMode, Permissions, PickApps, UnlockTime } from './screens/Onboarding';
import { Requests } from './screens/Requests';
import { Verify } from './screens/Verify';
import { Profile, Settings } from './screens/Settings';
import { Earned, Questions, TaskDetail, TaskForm, VerifyPhoto, Waiting } from './screens/Tasks';
import { Notifications, ScreenTime, Wallet } from './screens/Wallet';

const SIGNED_OUT = ['/welcome', '/signup', '/signin'];
const ONBOARDING = ['/onboarding/*', '/join'];
const CHILD_ALLOWED = [
  '/child',
  '/task/:id',
  '/task/:id/photo',
  '/task/:id/waiting',
  '/earned/:id',
  '/apps',
  '/app/:appId',
  '/locked/:appId',
  '/screen-time',
  '/notifications',
  '/profile',
  '/messages',
  '/messages/:id',
];

const matches = (patterns: string[], path: string) => patterns.some((p) => matchPath(p, path));

function homeFor(me: Account): string {
  if (me.mode === 'child' && me.parentId) return '/child';
  if (me.mode === 'parent') return '/family';
  return '/home';
}

/** Keeps each kind of user on the screens that make sense for them. */
function Gate({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const syncing = useStore((s) => s.syncing);
  useDailyTick();
  useLiveUpdates();
  useTimeZoneSync();
  useNativeBridge();

  if (!me && syncing) {
    // Signed in with the server but nothing downloaded yet: wait a moment instead of showing the welcome screen.
    return (
      <main className="screen centered" aria-busy="true">
        <p className="lead" style={{ textAlign: 'center' }}>
          Loading your tasks…
        </p>
      </main>
    );
  }
  if (!me) {
    return matches(SIGNED_OUT, pathname) ? <>{children}</> : <Navigate to="/welcome" replace />;
  }
  if (!me.onboarded) {
    if (matches(ONBOARDING, pathname)) return <>{children}</>;
    // A linked child finishing setup only has the permissions step left.
    return <Navigate to={me.parentId ? '/onboarding/permissions?for=child' : '/onboarding/mode'} replace />;
  }
  if (pathname === '/' || matches(SIGNED_OUT, pathname)) return <Navigate to={homeFor(me)} replace />;
  if (me.mode === 'child' && me.parentId && !matches(CHILD_ALLOWED, pathname)) return <Navigate to="/child" replace />;
  if (pathname === '/child' && !(me.mode === 'child' && me.parentId)) return <Navigate to={homeFor(me)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <HashRouter>
      <div className="stage">
        <div className="phone">
          <Gate>
            <Routes>
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="/signin" element={<SignIn />} />

              <Route path="/onboarding/mode" element={<ChooseMode />} />
              <Route path="/onboarding/permissions" element={<Permissions />} />
              <Route path="/onboarding/apps" element={<PickApps />} />
              <Route path="/onboarding/unlock" element={<UnlockTime />} />
              <Route path="/onboarding/verifier" element={<AddVerifier />} />
              <Route path="/join" element={<JoinFamily />} />

              <Route path="/home" element={<Home />} />
              <Route path="/task/new" element={<TaskForm />} />
              <Route path="/task/:id" element={<TaskDetail />} />
              <Route path="/task/:id/edit" element={<TaskForm />} />
              <Route path="/task/:id/photo" element={<VerifyPhoto />} />
              <Route path="/task/:id/waiting" element={<Waiting />} />
              <Route path="/task/:id/questions" element={<Questions />} />
              <Route path="/earned/:id" element={<Earned />} />

              <Route path="/wallet" element={<Wallet />} />
              <Route path="/screen-time" element={<ScreenTime />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/verifier" element={<AddVerifier editing />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/messages/:id" element={<Chat />} />

              <Route path="/apps" element={<Launcher />} />
              <Route path="/app/:appId" element={<AppView />} />
              <Route path="/locked/:appId" element={<Locked />} />
              <Route path="/emergency/:appId" element={<Emergency />} />

              <Route path="/family" element={<ParentHome />} />
              <Route path="/family/link" element={<LinkChild />} />
              <Route path="/family/task/new" element={<ChildTaskForm />} />
              <Route path="/family/approve/:id" element={<ApproveProof />} />
              <Route path="/family/child/:childId" element={<ChildWeek />} />
              <Route path="/family/child/:childId/rules" element={<ChildRules />} />
              <Route path="/child" element={<ChildHome />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Gate>
          <Toast />
        </div>
      </div>
    </HashRouter>
  );
}
