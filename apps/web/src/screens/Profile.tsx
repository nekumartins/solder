import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { COPY, formatUsd } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { Button } from '../components/Button.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';

interface ProfileResponse {
  user: { handle: string; displayName: string };
  isYou: boolean;
  canReceive: boolean;
}

/**
 * What a shared link opens: solder.app/@ana, optionally pre-filled with an
 * amount. Works signed out, so the first thing a new person sees is a face
 * and a name, not a sign-up wall.
 */
export function Profile() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const phase = useApp((state) => state.phase);
  const me = useApp((state) => state.me);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [missing, setMissing] = useState(false);

  const amount = params.get('amount');
  const reason = params.get('for');

  useEffect(() => {
    void api.get<ProfileResponse>(`/api/users/${handle}`)
      .then(setProfile)
      .catch(() => setMissing(true));
  }, [handle]);

  useEffect(() => {
    // Your own link just takes you home.
    if (profile?.isYou) navigate('/me', { replace: true });
  }, [profile, navigate]);

  if (missing) {
    return (
      <div className="profile-land">
        <p className="profile-name">{COPY.pay.unknownPerson}</p>
        <Button size="lg" variant="secondary" onClick={() => navigate('/')}>Go home</Button>
      </div>
    );
  }

  const payHref = `/pay/${handle}${amount ? `?amount=${micros(amount)}` : ''}${
    reason ? `${amount ? '&' : '?'}for=${encodeURIComponent(reason)}` : ''}`;

  return (
    <div className="profile-land">
      <Avatar handle={handle} displayName={profile?.user.displayName} size={92} />
      <p className="profile-name">{profile?.user.displayName ?? `@${handle}`}</p>
      <p className="profile-handle">@{handle}</p>

      {amount && (
        <p className="profile-amount num">{formatUsd(BigInt(micros(amount)))}</p>
      )}
      {reason && <p className="profile-reason">{reason}</p>}

      {phase === 'ready' && me ? (
        <Button size="lg" onClick={() => navigate(payHref)}>
          Send {profile?.user.displayName?.split(' ')[0] ?? `@${handle}`} money
        </Button>
      ) : (
        <>
          <Button size="lg" onClick={() => navigate('/claim')}>{COPY.welcome.create}</Button>
          <Button size="lg" variant="ghost" onClick={() => navigate('/welcome')}>
            {COPY.welcome.signIn}
          </Button>
        </>
      )}
    </div>
  );
}

/** Links carry dollars ("12.50"); the app speaks micros. */
function micros(value: string): string {
  if (/^\d+$/.test(value) && value.length > 6) return value;
  const [whole = '0', fraction = ''] = value.split('.');
  return (BigInt(whole || '0') * 1_000_000n + BigInt((fraction.padEnd(6, '0')).slice(0, 6) || '0')).toString();
}
