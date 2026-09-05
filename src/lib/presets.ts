import { Book } from '../types';

export const PRESET_BOOKS: Book[] = [
  {
    id: 'book-midnight-archives',
    title: 'The Midnight Archives of Highgate',
    subtitle: 'A Victorian Mystery of Forgotten Codices',
    synopsis:
      'In the fog-drenched cobbled alleys of Victorian London, strange alchemical manuscripts have begun surfacing from sunken subterranean vaults. Scholars, detectives, and veiled patrons congregate at the antiquarian bookshop in search of answers.',
    setting:
      'Highgate, London, autumn of 1888. A gas-lit antiquarian bookshop with towering mahogany shelves, crackling coal hearths, and rain beating against stained glass.',
    dialogueTone: 'Victorian Gothic & Classic Literary',
    prologue:
      '*Rain lashes violently against the leaded panes of the Highgate Archives, casting trembling water shadows across mahogany shelves that groan with centuries of leather-bound folios. The scent of damp wool, pipe tobacco, and ancient cedarwood hangs heavy in the air.*\n\n*Behind a sprawling oak desk littered with brass calipers and cracked wax seals, Arthur Pendelton sets down his tea cup with a quiet clatter, pushing his spectacles up the bridge of his nose as the front bell chimes.*\n\n"Mind the threshold," *Arthur murmurs softly, glancing toward the door.* "The street is ankle-deep in London sludge tonight. Come near the hearth—unless you carry something that cannot bear heat?"',
    coverColor: '#7a282f', // Antique Burgundy
    coverIcon: 'BookOpen',
    characters: [
      {
        id: 'char-arthur',
        name: 'Arthur Pendelton',
        role: 'The Antiquarian Shopkeeper',
        voiceTone: 'Poetic & Formal',
        description:
          'Erudite and dryly witty collector of forbidden codices, with ink-stained fingers and an encyclopedic knowledge of London occult history.',
        color: '#7a282f',
        createdAt: 1700000000000,
      },
      {
        id: 'char-miller',
        name: 'Inspector Miller',
        role: 'Scotland Yard Investigator',
        voiceTone: 'Gritty & Blunt',
        description:
          'A weary, sharp-eyed detective troubled by recent unexplainable occurrences near the Thames docks.',
        color: '#2a4365',
        createdAt: 1700000001000,
      },
      {
        id: 'char-vespera',
        name: 'Madame Vespera',
        role: 'Veiled Patron & Occult Scholar',
        voiceTone: 'Cryptic & Whispering',
        description:
          'An enigmatic noblewoman who visits only during torrential downpours, seeking a lost Babylonian astrological chart.',
        color: '#44337a',
        createdAt: 1700000002000,
      },
    ],
    chapters: [
      {
        id: 'chap-archives-1',
        bookId: 'book-midnight-archives',
        title: 'Chapter I: The Veiled Visitor in the Rain',
        messages: [
          {
            id: 'msg-archives-init',
            role: 'assistant',
            content:
              '*Rain lashes violently against the leaded panes of the Highgate Archives, casting trembling water shadows across mahogany shelves that groan with centuries of leather-bound folios. The scent of damp wool, pipe tobacco, and ancient cedarwood hangs heavy in the air.*\n\n*Behind a sprawling oak desk littered with brass calipers and cracked wax seals, Arthur Pendelton sets down his tea cup with a quiet clatter, pushing his spectacles up the bridge of his nose as the front bell chimes.*\n\n"Mind the threshold," *Arthur murmurs softly, glancing toward the door.* "The street is ankle-deep in London sludge tonight. Come near the hearth—unless you carry something that cannot bear heat?"',
            timestamp: 1700000010000,
          },
        ],
        createdAt: 1700000010000,
        updatedAt: 1700000010000,
      },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000010000,
    isPreset: true,
  },
  {
    id: 'book-perseus-veil',
    title: 'The Perseus Horizon',
    subtitle: 'Deep Space Solitude & Cosmic Beacons',
    synopsis:
      'Drifting beyond the reach of federation comms relays on the research vessel Wanderer, an isolated crew monitors radio frequencies shimmering from the edge of the purple Perseus Veil nebula.',
    setting:
      'The quiet observation deck of the long-range scout ship Wanderer. Vast panoramic viewports revealing shimmering violet cosmic dust, faint reactor hums, and flickering instrument consoles.',
    dialogueTone: 'Cosmic Hard Sci-Fi',
    prologue:
      '*The observation viewport looks out into an ocean of indigo and amethyst nebular dust. Starlight refracts in delicate geometric halos against the reinforced quartz glass. The only sound is the rhythmic, mechanical heartbeat of the atmospheric scrubbers.*\n\n*First Navigator Lyra Vance stands with a mug of warm chicory, staring into the cosmic expanse. At the sensor array nearby, automated telemetry lines scroll in green phosphorescence. A chime breaks the silence as an uncataloged signal frequency registers on the primary radar.*\n\n*Lyra turns her head toward the entry hatch, a faint, intrigued smile touching her lips.*\n\n"Comms receiver picked up a harmonic pulse," *she says into the quiet room.* "It doesn\'t match solar static or debris friction. Take a look at these readings before the beacon drifts past our line of sight."',
    coverColor: '#1e3a5f', // Deep Nautical Navy
    coverIcon: 'Compass',
    characters: [
      {
        id: 'char-lyra',
        name: 'Lyra Vance',
        role: 'First Navigator',
        voiceTone: 'Poetic & Lyrical',
        description:
          'Introspective, poetically minded celestial navigator who finds comfort in the mathematical quiet of deep space.',
        color: '#1e3a5f',
        createdAt: 1700000100000,
      },
      {
        id: 'char-cole',
        name: 'Chief Engineer Marcus Cole',
        role: 'Maintenance Specialist',
        voiceTone: 'Casual & Conversational',
        description:
          'A pragmatic, grease-stained veteran mechanic who talks to the reactor core like an old stubborn hound.',
        color: '#744210',
        createdAt: 1700000101000,
      },
      {
        id: 'char-echo',
        name: 'Echo-7',
        role: 'Vessel Audio Synthesis & AI',
        voiceTone: 'Scholarly & Analytical',
        description:
          'The shipboard navigational computer, speaking in measured, soft chimes and gently analytical assessments.',
        color: '#234e52',
        createdAt: 1700000102000,
      },
    ],
    chapters: [
      {
        id: 'chap-perseus-1',
        bookId: 'book-perseus-veil',
        title: 'Chapter I: The Signal in the Violet Dust',
        messages: [
          {
            id: 'msg-perseus-init',
            role: 'assistant',
            content:
              '*The observation viewport looks out into an ocean of indigo and amethyst nebular dust. Starlight refracts in delicate geometric halos against the reinforced quartz glass. The only sound is the rhythmic, mechanical heartbeat of the atmospheric scrubbers.*\n\n*First Navigator Lyra Vance stands with a mug of warm chicory, staring into the cosmic expanse. At the sensor array nearby, automated telemetry lines scroll in green phosphorescence. A chime breaks the silence as an uncataloged signal frequency registers on the primary radar.*\n\n*Lyra turns her head toward the entry hatch, a faint, intrigued smile touching her lips.*\n\n"Comms receiver picked up a harmonic pulse," *she says into the quiet room.* "It doesn\'t match solar static or debris friction. Take a look at these readings before the beacon drifts past our line of sight."',
            timestamp: 1700000110000,
          },
        ],
        createdAt: 1700000110000,
        updatedAt: 1700000110000,
      },
    ],
    createdAt: 1700000100000,
    updatedAt: 1700000110000,
    isPreset: true,
  },
  {
    id: 'book-belvoir-winter',
    title: 'Winter at Belvoir Estate',
    subtitle: 'An Alpine Chronicle of Exile & Intrigue',
    synopsis:
      'High in an alpine mountain pass, political exiles, cloaked couriers, and quiet schemers gather in the candle-lit salon of Lady Cordelia’s villa while snow seals the passes.',
    setting:
      'A remote stone villa overlooking Lake Belvoir during a severe winter blizzard. Grand stone hearths, tapestries, frosted arched windows, and whispering corridors.',
    dialogueTone: 'Aristocratic Intrigue & Formal Literary',
    prologue:
      '*Heavy birch logs crackle inside the stone hearth of the Belvoir salon, shedding glowing amber warmth over velvet cushions and polished pewter decanters. Outside, high winds howl across the mountain ridge, piling thick snow against the double-paned windows.*\n\n*Lady Cordelia Vane sits in a high-backed armchair, slowly turning a silver signet ring upon her thumb. Across the table, Lord Raymond Ashford paces quietly, his heavy wool cloak still damp from the trail.*\n\n*Cordelia looks toward the entryway as footsteps echo over the parquet floor.*\n\n"The mountain road is officially buried beneath three feet of drift," *she notes with calm composure, raising her wine glass slightly.* "Which means whoever entered this estate tonight will remain our guest until the spring thaw. Come closer to the fire. We have much to discuss before the couriers awaken."',
    coverColor: '#2d4b3e', // Forest Spruce
    coverIcon: 'Feather',
    characters: [
      {
        id: 'char-cordelia',
        name: 'Lady Cordelia Vane',
        role: 'Master of the Whispering Court',
        voiceTone: 'Formal & Aristocratic',
        description:
          'Exiled diplomat and subtle strategist who weighs every word like a heavy silver coin.',
        color: '#2d4b3e',
        createdAt: 1700000200000,
      },
      {
        id: 'char-ashford',
        name: 'Lord Raymond Ashford',
        role: 'Exiled Commander',
        voiceTone: 'Gritty & Blunt',
        description:
          'A grim, battle-tested officer seeking refuge after the fall of the capital garrison.',
        color: '#4a5568',
        createdAt: 1700000201000,
      },
      {
        id: 'char-thomas',
        name: 'Thomas the Courier',
        role: 'Alpine Messenger',
        voiceTone: 'Casual & Conversational',
        description:
          'A breathless, frost-bitten youth carrying wax-sealed dispatches hidden in the lining of his boots.',
        color: '#7b341e',
        createdAt: 1700000202000,
      },
    ],
    chapters: [
      {
        id: 'chap-belvoir-1',
        bookId: 'book-belvoir-winter',
        title: 'Chapter I: The Snowbound Council',
        messages: [
          {
            id: 'msg-belvoir-init',
            role: 'assistant',
            content:
              '*Heavy birch logs crackle inside the stone hearth of the Belvoir salon, shedding glowing amber warmth over velvet cushions and polished pewter decanters. Outside, high winds howl across the mountain ridge, piling thick snow against the double-paned windows.*\n\n*Lady Cordelia Vane sits in a high-backed armchair, slowly turning a silver signet ring upon her thumb. Across the table, Lord Raymond Ashford paces quietly, his heavy wool cloak still damp from the trail.*\n\n*Cordelia looks toward the entryway as footsteps echo over the parquet floor.*\n\n"The mountain road is officially buried beneath three feet of drift," *she notes with calm composure, raising her wine glass slightly.* "Which means whoever entered this estate tonight will remain our guest until the spring thaw. Come closer to the fire. We have much to discuss before the couriers awaken."',
            timestamp: 1700000210000,
          },
        ],
        createdAt: 1700000210000,
        updatedAt: 1700000210000,
      },
    ],
    createdAt: 1700000200000,
    updatedAt: 1700000210000,
    isPreset: true,
  },
];
