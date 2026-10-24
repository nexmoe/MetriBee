const { expect } = require("chai");
const { sun, altitude, isNight, HORIZON } = require("../public/js/sun");

describe("globe sun math", () => {
  it("puts the subsolar point on the equator at the March equinox", () => {
    const s = sun(new Date("2026-03-20T14:46:00Z"));
    expect(Math.abs(s.lat)).to.be.below(0.1);
  });

  it("puts the subsolar point on the Tropic of Cancer at the June solstice, near Greenwich at 12:00 UTC", () => {
    const s = sun(new Date("2026-06-21T12:00:00Z"));
    expect(s.lat).to.be.closeTo(23.44, 0.05);
    expect(s.lng).to.be.closeTo(0, 1); /* equation of time is under 2 min in June */
  });

  it("has the sun overhead at the subsolar point", () => {
    const s = sun(new Date("2026-10-09T09:00:00Z"));
    expect(altitude(s, s.lat, s.lng)).to.be.closeTo(90, 0.01);
  });

  it("tells day from night for known cities at a fixed UTC time", () => {
    const t = new Date("2026-01-15T06:30:00Z"); /* 12:00 in Delhi, 01:30 in New York */
    expect(isNight(28.61, 77.21, t)).to.equal(false);
    expect(isNight(40.71, -74.01, t)).to.equal(true);
    expect(HORIZON).to.equal(-0.833);
  });
});
