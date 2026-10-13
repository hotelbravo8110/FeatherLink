I've updated FEATHER NET. Please replace the current artifact's files with the attached FEATHER_NET.zip (index.html and brief/brief.html) and republish it to the same artifact. brief/brief.html is unchanged from the last version. The FEATHER LINK extension is still 1.1.2 and hasn't changed. Keep all my campaign data as it is; nothing in the stored data format changed.

What's new, so you know when you write briefs and companions:

1. Logbook tab. It covers the tour so far:
   - tiles for sectors flown, block time, crew rating, on-time %, average and smoothest landing, and the clean-landing streak;
   - a tour map of every leg, X-Plane tracks where flown;
   - crew standing from the last 5 rated sectors (Golden crew / Trusted / Steady / Under review);
   - a "Notes from the party" wall;
   - a leg-by-leg table, with a ground line under each leg, e.g. "Car 2 14 min late out, held at a police road closure · held the door".

2. Cabin tab. A live top-down view of N511GW (Legacy 650, dark olive-grey livery, roof off) driven by the sim clock and groundPlan.
   - People:
     - Cars pull up and people get out, walk up the stairs and take their seats. Sabrina boards last and gets off first.
     - People walk around when the seatbelt sign is off, and Tomás does the service.
     - At the other end everyone deplanes into the waiting cars.
     - Tap anyone to see what they're doing, what's on their mind, their rating so far and what matters to them. "Ask what's on their mind" uses the quick tier.
   - Rules: Sabrina never speaks. Her rating comes "via Sarah". Thoughts about real people stay on their tour work: nothing about private lives, health or relationships.
   - Synced with the Map: cars appear in the Cabin when their people reach the FBO, and the Map keeps them parked at the FBO until boarding.

3. The drive is simulated. Each road gets seeded traffic lights (shown red or green on the Map in real time) and slow-traffic patches, and every car is driven second by second.
   - Car 1 is tuned to make the plan's time. The other cars queue behind it and can be split up by a light.
   - Seeded from the sector ref, about 45% of sectors get one car held up on its own (a bus, a lane closure, etc.). It's 1–3 min late and still makes boarding.
   - About a third of those are major: an accident, a police closure, a detour or gridlock. That car arrives late enough to miss the engine start.
   - The Map's "On the move" panel shows why a car is held and its real ETA. The party board shows each person "in the car" until their own car arrives.

4. The drive talks.
   - A held-up car calls in on NET.
   - A major hold-up delivers a built-in event, "Car 2 running late" (id gx-dep-hold), from HOUSE TOUR. It's hold: true, so the start cue waits for my answer. The options:
     - "Hold for them": holds the departure until they're settled, score +0.6;
     - "Quick turn": holds only as long as needed, score +0.15.
   - The delay is logged as by:'event', so it doesn't count against the crew.
   - The motorcade now keeps its own times: a departure hold asked for after the cars have left doesn't re-time them.
   - When you write companion events, don't duplicate this one. You can refer to it in the next brief if it happened (it's in the debrief decisions).

5. The Cabin's outside world.
   - Real weather from the METAR: live from FEATHER LINK, or from the brief's weather.stations[].metar without the link. Rain gives a wet ramp, puddles and car wipers. There's also snow, fog/mist, and overcast flattening the shadows.
   - Real sun position for the place and time: long shadows at low sun, a golden tint, and at night a dark ramp with a lit cabin and floodlit stairs.
   - Sun position uses companion.places airport lat/lon, so please keep including airport positions in places.
   - The aircraft moves:
     - stairs fold up at door close, and the red beacon runs with the engines;
     - taxi out with the stand sliding away;
     - takeoff roll with strobes, then fields and cloud below in flight;
     - on landing, a rollout and taxi in, then pulling onto the stand with the arrival cars already waiting, and the stairs come down.
   - A status line next to the seatbelt sign reads e.g. "Taxiing · Dusk, light rain at KTEB".

Please confirm it loads, then show me the Cabin tab.
