import type { CharacterId, Mood } from './characters';

/*
 * ============================================================================================
 *  CONVERSATIONS  (all PLACEHOLDER writing: the real story will replace this)
 * ============================================================================================
 *
 *  Each conversation belongs to one crew member (`npc`). When you talk to them, the game picks
 *  the highest-`priority` conversation that you haven't seen yet and whose `when` condition is
 *  true. Seen conversations are remembered (so the crew always has something new as runs go by).
 *  If nothing new is available, they say one of their short `IDLE` lines instead.
 *
 *  A line is either:
 *    { who: 'rook', mood: 'happy', text: 'Some words.' }
 *  or a choice for the player, where each option can have its own reply lines:
 *    { choices: [ { text: 'Option A', reply: [ ...lines ] }, { text: 'Option B' } ] }
 *
 *  Moods: neutral, happy, annoyed, surprised, sad  (each can have its own portrait art).
 *  Use {callsign} for the player's callsign.
 *
 *  Conditions (`when`) can look at: s.runs, s.wins, s.deaths, s.lastRun (won, sectors, kills),
 *  s.seen('conversation-id'), s.salvage.
 * ============================================================================================
 */

export interface LineSpoken {
  who: CharacterId;
  mood?: Mood;
  text: string;
}

export interface LineChoice {
  /** `action` is a game event to fire when picked (e.g. 'guide:armory' shows a waypoint). */
  choices: { text: string; reply?: Line[]; action?: string }[];
}

export type Line = LineSpoken | LineChoice;

export interface StoryState {
  runs: number;
  wins: number;
  deaths: number;
  salvage: number;
  lastRun: { won: boolean; sectors: number; kills: number } | null;
  seen: (id: string) => boolean;
  /** Contracts finished in total, and for one crew member ('rook', 'juno', 'pip'). */
  contracts: number;
  contractsFor: (who: string) => number;
}

export interface Conversation {
  id: string;
  npc: Exclude<CharacterId, 'pilot'>;
  priority?: number;
  when?: (s: StoryState) => boolean;
  lines: Line[];
}

export const CONVERSATIONS: Conversation[] = [
  // ---------------------------------------------------------------- BOLT (info desk robot)
  // After any of these, BOLT always offers directions (see HomeBase: the choices are built there).
  {
    id: 'bot-intro',
    npc: 'bot',
    priority: 100,
    lines: [
      { who: 'bot', mood: 'happy', text: 'GREETINGS, PILOT {callsign}! Welcome to Halcyon Station, Deck 3. I am BOLT, your information unit.' },
      { who: 'bot', mood: 'neutral', text: 'Halcyon has four hundred and twelve rooms. Most of them are sealed. Budget cuts. And the Bloom.' },
      { who: 'bot', mood: 'happy', text: 'The rooms that ARE open are right off this concourse. Ask me where anything is!' },
      { who: 'bot', mood: 'neutral', text: 'I also keep the CONTRACT BOARD. The crew post jobs for your sorties: take one, finish it, get paid. Very efficient.' },
    ],
  },
  {
    id: 'bot-after-run',
    npc: 'bot',
    priority: 20,
    when: (s) => s.runs >= 1,
    lines: [
      { who: 'bot', mood: 'surprised', text: 'Pilot! Sensors show you departed and returned. Statistically, that is my favourite outcome.' },
    ],
  },
  {
    id: 'bot-first-contract',
    npc: 'bot',
    priority: 30,
    when: (s) => s.contracts >= 1,
    lines: [
      { who: 'bot', mood: 'happy', text: 'CONTRACT COMPLETE! I have added a gold star to your file. It is the only star in your file.' },
      { who: 'bot', mood: 'neutral', text: 'New jobs go up after every sortie. Check the board!' },
    ],
  },
  // ---------------------------------------------------------------- Rook
  {
    id: 'rook-contract-done',
    npc: 'rook',
    priority: 40,
    when: (s) => s.contractsFor('rook') >= 1,
    lines: [
      { who: 'rook', mood: 'happy', text: "Job done, and you came back in one piece. That's two things I like." },
      { who: 'rook', mood: 'neutral', text: "Keep taking my contracts and I'll keep finding things worth shooting." },
    ],
  },
  {
    id: 'rook-intro',
    npc: 'rook',
    priority: 100,
    lines: [
      { who: 'rook', mood: 'neutral', text: "So you're the new pilot. {callsign}, right? Name's Rook. I run supplies on the Halcyon." },
      { who: 'rook', mood: 'annoyed', text: 'Last pilot we had flew like they had nine lives. Turns out they had one.' },
      {
        choices: [
          {
            text: "I'll be more careful.",
            reply: [{ who: 'rook', mood: 'neutral', text: "Careful doesn't pay. Salvage does. Bring me scrap, I'll bolt better armor onto you." }],
          },
          {
            text: 'What happened to them?',
            reply: [
              { who: 'rook', mood: 'sad', text: '...Ask me again when you have a few more sorties under your belt.' },
              { who: 'rook', mood: 'neutral', text: 'For now: bring me salvage. I turn it into things that keep you breathing.' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'rook-first-death',
    npc: 'rook',
    priority: 80,
    when: (s) => s.deaths >= 1 && !!s.lastRun && !s.lastRun.won,
    lines: [
      { who: 'rook', mood: 'annoyed', text: 'Pulled you out of the wreck myself. You owe me a new winch.' },
      { who: 'rook', mood: 'neutral', text: "Getting shot down is part of the job down there. Staying shot down isn't. Spend that scrap." },
    ],
  },
  {
    id: 'rook-first-win',
    npc: 'rook',
    priority: 90,
    when: (s) => s.wins >= 1,
    lines: [
      { who: 'rook', mood: 'surprised', text: 'You cleared the whole sortie? Huh.' },
      { who: 'rook', mood: 'happy', text: "Don't let it go to your helmet. ...But good flying, {callsign}." },
    ],
  },
  {
    id: 'rook-veteran',
    npc: 'rook',
    priority: 50,
    when: (s) => s.runs >= 4,
    lines: [
      { who: 'rook', mood: 'neutral', text: "You keep coming back. Most don't. The last pilot did, for a while." },
      { who: 'rook', mood: 'sad', text: "They used to sit right where you're standing. Talked about the towers like they were... listening." },
      {
        choices: [
          { text: 'Listening?', reply: [{ who: 'rook', mood: 'annoyed', text: "Forget I said it. Go break some towers." }] },
          { text: 'Sounds like a ghost story.', reply: [{ who: 'rook', mood: 'neutral', text: 'Out here, those tend to be true.' }] },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Juno
  {
    id: 'juno-intro',
    npc: 'juno',
    priority: 100,
    lines: [
      { who: 'juno', mood: 'happy', text: "Oh, fresh pilot! Hello, darling. I'm Juno. I dress the crew so we die looking fabulous." },
      { who: 'juno', mood: 'surprised', text: 'Is that... standard issue? Under all that armor? Tragic.' },
      {
        choices: [
          { text: "It's practical.", reply: [{ who: 'juno', mood: 'annoyed', text: 'So is a bucket. Come see me when you have salvage, and taste.' }] },
          { text: 'What do you recommend?', reply: [{ who: 'juno', mood: 'happy', text: 'Crimson. Always crimson. The enemy should know who blew them up.' }] },
        ],
      },
    ],
  },
  {
    id: 'juno-after-run',
    npc: 'juno',
    priority: 60,
    when: (s) => s.runs >= 2,
    lines: [
      { who: 'juno', mood: 'neutral', text: 'I used to run cargo through this system, you know. Before the Bloom. Before the towers.' },
      { who: 'juno', mood: 'sad', text: 'Whole cities down there, once. Now it grows jungle and guns.' },
      { who: 'juno', mood: 'happy', text: "Anyway! Enough gloom. Let's talk about your helmet." },
    ],
  },

  {
    id: 'juno-contract-done',
    npc: 'juno',
    priority: 40,
    when: (s) => s.contractsFor('juno') >= 1,
    lines: [
      { who: 'juno', mood: 'happy', text: 'You actually did it! Darling, reliability is SO attractive.' },
      { choices: [{ text: 'Just doing my job.', reply: [{ who: 'juno', mood: 'annoyed', text: 'Ugh, modest too. Stop it.' }] }, { text: 'Pay me in outfits?', reply: [{ who: 'juno', mood: 'happy', text: 'Salvage first. Outfits are for paying customers.' }] }] },
    ],
  },
  // ---------------------------------------------------------------- Pip
  {
    id: 'pip-intro',
    npc: 'pip',
    priority: 100,
    lines: [
      { who: 'pip', mood: 'happy', text: "Hi hi hi! You're {callsign}! I'm Pip! I fixed your ship! Well, I fix everything. The station, mostly. It's held together with tape." },
      { who: 'pip', mood: 'surprised', text: 'Not really tape. Okay, a little tape.' },
      { who: 'pip', mood: 'neutral', text: "The Manta's yours. If you find enough salvage, I've got other birds in the back you can take out." },
    ],
  },
  {
    id: 'pip-first-death',
    npc: 'pip',
    priority: 80,
    when: (s) => s.deaths >= 1,
    lines: [
      { who: 'pip', mood: 'sad', text: 'Your ship came back in so many pieces. I counted! Four hundred and twelve!' },
      { who: 'pip', mood: 'happy', text: "Good news: I put them all back. Bad news: there's a spare bolt and I don't know where it goes." },
    ],
  },
  {
    id: 'pip-contract-done',
    npc: 'pip',
    priority: 40,
    when: (s) => s.contractsFor('pip') >= 1,
    lines: [
      { who: 'pip', mood: 'surprised', text: 'You did my contract?! Nobody ever does my contracts!' },
      { who: 'pip', mood: 'happy', text: "I'm putting your name on the good wrench. The GOOD one." },
    ],
  },
];

/** Short one-liners when a crew member has nothing new to say. */
export const IDLE: Record<Exclude<CharacterId, 'pilot'>, string[]> = {
  bot: ['HOW MAY I DIRECT YOU, PILOT?', 'Lost? Statistically likely. Ask me.', 'Beep. That was a friendly beep.'],
  rook: ['Got salvage? Then we have business.', 'Armor first. Always armor first.', "You're letting the cold in. Shop or fly."],
  juno: ["Darling, you're glowing. Or that's plasma burn.", 'Fashion is armor for the soul.', 'Stand up straight. Pilots slouch.'],
  pip: ['Ship is good to go! Probably!', "I named a wrench after you. It's my favorite wrench.", 'Bring me back something shiny!'],
};
