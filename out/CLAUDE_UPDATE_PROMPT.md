Another FEATHER NET update. Please replace the artifact's files with the attached FEATHER_NET.zip (index.html and brief/brief.html) and republish to the same artifact. Keep all my campaign data; nothing in the stored format changed except two new optional fields, listed below.

I've also updated FEATHER LINK to 1.1.3 (attached feather-link.mcpb). It now reads the sim's weather in more detail: cloud layers, precipitation, pressure, dew point, ground elevation and the sim's sun position. I'm installing it in Claude Desktop myself.

What changed:

1. Cars drive all the way to the aircraft.
   - Each sector has a stand position: where N511GW is parked on the apron at each FBO.
   - The cars' route is the road to the FBO, then airside to the stand. The Map draws the aircraft at the stand, and the cars finish their drive there.
   - Where the stand position comes from:
     - when X-Plane is live and parked near an FBO, the sim's real position (saved as sector.rampFix.dep/arr with src 'sim');
     - otherwise the app asks you (quick tier), once per sector, where a Legacy 650 would park in front of that FBO (src 'claude', must be within 500 m of the FBO);
     - if neither is available, a short step from the FBO toward the field.
   - Please keep giving accurate FBO and airport positions in companion.places.

2. Boarding is immediate.
   - People get out of their car and walk straight up the stairs; nobody stands around on the ramp. Jonah loads the hold for a few minutes, then boards.
   - When the last person is aboard, Tomás calls it on ICS: "Cap, cabin's complete…".
   - At the other end, people come down the stairs and go straight into their waiting car, which leaves at the planned time.
   - The Cabin no longer freezes people mid-walk when you switch tabs; it catches up when you come back.

3. Sabrina has thoughts in the Cabin like everyone else. This is all fiction.
   - She still doesn't use the radio.
   - Keep her thoughts warm and about the tour, the show and the flight.

4. Every screen fills the window: no width cap, and a bigger Map, Cabin and side panels. Type is larger on big screens.

5. Weather comes from the sim.
   - When X-Plane is live, the app builds a METAR from the sim's own weather, e.g. "SIM 031733Z 07018KT 2SM RA OVC010 14/12 A2981".
   - It uses that METAR for the Cabin's weather, Priya's departure weather call and a new "In the sim" row on the Weather card.
   - The Cabin's daylight uses the sim's sun.
   - Real METARs are still used for the destination, and for everything when the sim isn't linked.

6. The director: you now run the day live.
   - The app calls you (quick tier) at each key moment:
     - the plan check at the start of the day;
     - cars on the road, and a car held up;
     - everyone aboard and engines started;
     - airborne, the cruise with the sign off and top of descent;
     - landed, on blocks, and arriving at the hotel or venue.
   - Each call sends you:
     - the real state: where every person is and what they're doing, each car's progress and hold-ups, the weather;
     - the captain's decisions, the rating so far and recent messages.
   - You return:
     - 0–2 radio or interphone lines from whoever would really speak, which get queued into the feed;
     - thoughts for 3–5 people, shown in the Cabin as "Written by Claude for this moment";
     - what 2–4 people are doing, shown on the party board and in the Cabin.
   - It's stored as flight.aiThoughts and flight.aiDoing.
   - Please keep these lines consistent with the companion you wrote, and don't invent emergencies or schedule changes there.

Please confirm it loads, then show me the Map and the Cabin tab.
