export type ProfileField = 'age' | 'relationshipStatus' | 'togetherDuration' | 'hasKids' | 'conflictStyle' | 'repairNeed' | 'fightTopics' | 'goal' | 'partnerName' | 'source';

export type ProfileQuestion = {
  key: ProfileField;
  title: string;
  description?: string;
  multiple?: boolean;
  options: readonly (readonly [string, string])[];
};

export const profileQuestions: ProfileQuestion[] = [
  { key: 'conflictStyle', title: 'In a fight, you usually…', description: 'Tap one. We’ll use it to shape your guidance.', options: [['get_loud', 'Raise my voice'], ['shut_down', 'Go quiet'], ['talk_now', 'Try to fix it fast'], ['need_space', 'Leave the room']] },
  { key: 'repairNeed', title: 'After a fight, what helps you most?', options: [['alone_time', 'Some space first'], ['being_heard', 'Talking it out'], ['closeness', 'A hug'], ['apology', 'Hearing “sorry”']] },
  { key: 'source', title: 'How did you find us?', options: [['instagram_facebook', 'Instagram or Facebook'], ['tiktok', 'TikTok'], ['google', 'Google search'], ['partner_link', 'My partner sent a link'], ['friend', 'A friend'], ['other', 'Something else']] },
];

export const relationshipOptions = [['dating', 'Dating'], ['engaged', 'Engaged'], ['married', 'Married']] as const;

export const partnerQuestions: ProfileQuestion[] = [
  { key: 'age', title: 'How old are you?', options: [['25-29', '25–29'], ['30-34', '30–34'], ['35-39', '35–39'], ['40-45', '40–45'], ['other', 'Another age range']] },
  ...profileQuestions.filter(({ key }) => key === 'conflictStyle' || key === 'repairNeed'),
];

// Canonical Mini-IPIP order from docs/features/backend-mvp/FRONTEND_CONTRACT.md.
export const personalityQuestions = [
  'Am the life of the party.',
  'Sympathize with others’ feelings.',
  'Get chores done right away.',
  'Have frequent mood swings.',
  'Have a vivid imagination.',
  'Don’t talk a lot.',
  'Am not interested in other people’s problems.',
  'Often forget to put things back in their proper place.',
  'Am relaxed most of the time.',
  'Am not interested in abstract ideas.',
  'Talk to a lot of different people at parties.',
  'Feel others’ emotions.',
  'Like order.',
  'Get upset easily.',
  'Have difficulty understanding abstract ideas.',
  'Keep in the background.',
  'Am not really interested in others.',
  'Make a mess of things.',
  'Seldom feel blue.',
  'Do not have a good imagination.',
];

export const personalityScale = ['Very inaccurate', 'Moderately inaccurate', 'Neither inaccurate nor accurate', 'Moderately accurate', 'Very accurate'];
