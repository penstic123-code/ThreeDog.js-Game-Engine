// Named fixed camera views of the room (engine.content.load -> engine.views.define). Same name = same framing every time, so two screenshots
// differ only by time, style or code: npm run shot -- action --view corner (the page is action.html; add --compare before.png to diff a change).
export default {
  corner: { position: [7, 5, -8], target: [0, 1, 0], fov: 55 },     // the whole room from a corner, a little above
  door: { position: [0, 2.2, 9], target: [0, 1.2, 0] },             // from the far side looking back at the spawn
};
