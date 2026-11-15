export type ProfileField = 'age' | 'relationshipStatus' | 'togetherDuration' | 'hasKids' | 'conflictStyle' | 'repairNeed' | 'fightTopics' | 'goal';

export type ProfileQuestion = {
  key: ProfileField;
  title: string;
  description?: string;
  multiple?: boolean;
  options: readonly (readonly [string, string])[];
};

export const profileQuestions: ProfileQuestion[] = [
  { key: 'age', title: 'How old are you?', description: 'Choose your age range.', options: [['25-29', '25–29'], ['30-34', '30–34'], ['35-39', '35–39'], ['40-45', '40–45'], ['other', 'Another age range']] },
  { key: 'relationshipStatus', title: 'Where are you in your relationship?', options: [['dating', 'Dating'], ['living_together', 'Living together'], ['engaged', 'Engaged'], ['married', 'Married']] },
  { key: 'togetherDuration', title: 'How long have you been together?', options: [['<1', 'Less than a year'], ['1-3', '1–3 years'], ['3-7', '3–7 years'], ['7+', 'More than 7 years']] },
  { key: 'hasKids', title: 'Do you have children?', options: [['no', 'No'], ['expecting', 'We’re expecting'], ['yes', 'Yes']] },
  { key: 'conflictStyle', title: 'When a conversation gets difficult, what do you tend to do?', options: [['talk_now', 'Want to talk right away'], ['need_space', 'Need some space'], ['get_loud', 'Raise my voice'], ['shut_down', 'Go quiet']] },
  { key: 'repairNeed', title: 'What helps you reconnect?', options: [['being_heard', 'Feeling heard'], ['apology', 'An apology'], ['plan', 'A clear plan'], ['closeness', 'A little closeness'], ['alone_time', 'Some time alone']] },
  { key: 'fightTopics', title: 'What tends to come between you?', description: 'Choose one to three topics.', multiple: true, options: [['money', 'Money'], ['chores', 'Housework'], ['family', 'Family'], ['time_attention', 'Time and attention'], ['phone', 'Phones'], ['jealousy', 'Jealousy'], ['closeness', 'Closeness'], ['plans_decisions', 'Plans and decisions'], ['kids', 'Children'], ['other', 'Something else']] },
  { key: 'goal', title: 'What would you like to work toward?', options: [['fewer_fights', 'Fewer arguments'], ['understand_each_other', 'Understanding each other'], ['prepare_marriage', 'Preparing for marriage'], ['feel_close', 'Feeling closer']] },
];

export const partnerQuestions = profileQuestions.filter(({ key }) => ['age', 'conflictStyle', 'repairNeed'].includes(key));

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
