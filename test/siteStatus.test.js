const { expect } = require("chai");
const { siteStatus, summarize, matchHost } = require("../public/js/siteStatus");

const week = (n) => Array(7).fill(n);
const k = (vals) => siteStatus(vals).st.k;

describe("siteStatus", () => {
  it("flags each traffic state", () => {
    expect(k([...week(0), ...week(0)])).to.equal("dead");
    expect(k([...week(100), 100, 100, 0, 100, 100, 100, 100])).to.equal("gap");
    expect(k([...week(10), ...week(0)])).to.equal("gone");
    expect(k([...week(5), ...week(6)])).to.equal("low");
    expect(k([...week(100), ...week(60)])).to.equal("drop");
    expect(k([...week(100), ...week(160)])).to.equal("up");
    expect(k([...week(100), ...week(110)])).to.equal("steady");
  });

  it("marks new traffic when the week before was under 20", () => {
    const s = siteStatus([...week(1), ...week(20)]);
    expect(s.change).to.equal(null);
    expect(s.st).to.include({ k: "up", label: "New" });
  });

  it("adds an earnings drop only with >= 5 the week before", () => {
    const vals = [...week(100), ...week(100)];
    expect(siteStatus(vals, { last: 6, prev: 10 }).st.k).to.equal("edrop");
    expect(siteStatus(vals, { last: 1, prev: 4 }).st.k).to.equal("steady");
    expect(siteStatus(vals, { last: 8, prev: 10 }).st.k).to.equal("steady");
    const both = siteStatus([...week(100), ...week(50)], { last: 2, prev: 10 }).st;
    expect(both.k).to.equal("drop");
    expect(both.why).to.match(/Earnings down 80%/);
  });

  it("summarizes a snapshot with earnings and RPM", () => {
    const daily = {}, ads = {};
    for (let d = 1; d <= 14; d++) {
      const key = `202610${String(d).padStart(2, "0")}`;
      daily[key] = 100;
      ads[key] = { earnings: d <= 7 ? 2 : 1, pageViews: 1000 };
    }
    const { days, sites } = summarize({ properties: [{ id: 1, name: "example.com - GA4", daily, ads }] }, { currency: "USD" });
    expect(days).to.have.length(14);
    expect(sites[0]).to.include({ id: "1", name: "example.com", last: 700, earnLast: 7, earnChange: -50, rpm: 1 });
    expect(sites[0].st.k).to.equal("edrop");
  });

  it("matches hosts exactly first, then without www.", () => {
    const d = ["www.example.org", "example.org", "quiz.example.com", "www.other.com"];
    expect(matchHost("www.example.org", d)).to.equal("www.example.org");
    expect(matchHost("example.org", d)).to.equal("example.org");
    expect(matchHost("other.com", d)).to.equal("www.other.com");
    expect(matchHost("nope.com", d)).to.equal(null);
    expect(matchHost(null, d)).to.equal(null);
  });
});
