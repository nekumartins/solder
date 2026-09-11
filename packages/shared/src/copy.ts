/**
 * Every user-facing string lives here, so the "no crypto jargon" rule is
 * enforceable by reading one file.
 *
 * Vocabulary rules:
 *   address     -> "account" (and only under Settings -> Advanced)
 *   transaction -> "payment"
 *   gas / fee   -> not mentioned at all; the relayer pays it
 *   wallet      -> "your money"
 *   USDC        -> appears once, as the balance subtitle
 */

export const COPY = {
  app: {
    name: 'Solder',
    tagline: 'Send money like a message.',
  },
  welcome: {
    headline: 'Money that moves\nlike a message.',
    sub: 'Send dollars to friends by name. No account numbers, nothing to write down.',
    create: 'Create your account',
    signIn: 'I already have one',
    reassure: 'Secured by your face or fingerprint.',
  },
  claim: {
    title: 'Pick your name',
    sub: 'This is how friends find you. You can share it as a link.',
    handleLabel: 'Your name',
    displayLabel: 'Display name',
    checking: 'Checking…',
    available: 'Yours!',
    taken: 'Already taken',
    submit: 'Continue',
    creating: 'Setting you up…',
    biometric: 'Confirm with your face or fingerprint to finish.',
  },
  home: {
    balanceLabel: 'Your balance',
    balanceSub: 'USDC',
    send: 'Send',
    request: 'Request',
    split: 'Split',
    empty: 'No conversations yet',
    emptySub: 'Send a friend a few dollars to get started.',
    addMoney: 'Add money',
  },
  thread: {
    placeholder: 'Message',
    sendMoney: 'Send money',
    requestMoney: 'Ask for money',
    pay: 'Pay',
    decline: 'Decline',
    cancel: 'Cancel',
    declined: 'Declined',
    cancelled: 'Cancelled',
    paid: 'Paid',
    pending: 'Sending…',
    failed: "Didn't go through",
    youSent: 'You sent',
    youReceived: 'You got',
    youAsked: 'You asked for',
    asksYou: 'asks for',
    today: 'Today',
    yesterday: 'Yesterday',
  },
  pay: {
    title: 'Send',
    requestTitle: 'Request',
    noteePlaceholder: 'What for?',
    review: 'Slide to send',
    reviewRequest: 'Send request',
    confirming: 'Confirming…',
    sent: 'Sent',
    requested: 'Requested',
    insufficient: "That's more than you have",
    self: 'You can\'t send money to yourself',
    unknownPerson: 'No one goes by that name yet',
    tooBig: 'That is over your daily limit',
    offline: "You're offline — reconnect to send money",
  },
  split: {
    title: 'Split a bill',
    total: 'Total',
    withWhom: 'Split with',
    each: 'each',
    send: 'Ask everyone',
    progress: (paid: number, total: number) => `${paid} of ${total} paid`,
  },
  people: {
    title: 'To whom?',
    search: 'Search by name',
    recents: 'Recent',
    noResults: 'No one by that name',
  },
  profile: {
    yourCode: 'Your code',
    scanToPay: 'Friends can scan this to pay you',
    share: 'Share your link',
    copied: 'Link copied',
  },
  scan: {
    title: 'Scan',
    hint: 'Point at a Solder code',
    unsupported: 'This browser can\'t use the camera for codes.',
    pasteInstead: 'Paste a link instead',
  },
  settings: {
    title: 'Settings',
    account: 'Account',
    advanced: 'Advanced',
    advancedNote: 'Technical details for the curious. You never need these.',
    accountKey: 'Account key',
    network: 'Network',
    signOut: 'Sign out',
    addDemoMoney: 'Add demo money',
    installTitle: 'Add to home screen',
    installBody: 'Install Solder for a full-screen, app-like experience.',
    install: 'Install',
    iosInstall: 'Tap Share, then "Add to Home Screen".',
  },
  errors: {
    generic: 'Something went wrong. Try again.',
    offline: "You're offline",
    session: 'Please sign in again',
    passkeyFailed: "We couldn't confirm it was you",
    passkeyUnsupported: 'This device can\'t create a secure sign-in yet.',
    noBackup: "We couldn't find your account on this device",
  },
} as const;

/** Words that must never appear in user-facing strings. */
export const BANNED_WORDS: readonly string[] = [
  'seed phrase', 'mnemonic', 'private key', 'wallet address', 'gas', 'gwei',
  'blockchain', 'crypto', 'token', 'sign the transaction', 'approve transaction',
  'rpc', 'testnet',
];
