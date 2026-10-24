const { expect } = require("chai");
require("ts-node").register({ transpileOnly: true, files: true });
const apiController = require("../controllers/apiController");

describe("globe view", () => {
  it("renders with the main layout containing navbar", () => {
    let viewName;
    let options;
    const res = {
      render(name, opts) {
        viewName = name;
        options = opts;
      },
    };

    apiController.globeView({}, res);

    expect(viewName).to.equal("globe");
    // layout is not explicitly set so it uses the default main layout
    expect(options).to.not.have.property("layout");
  });
});
