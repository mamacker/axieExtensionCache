const https = require("https");
const express = require("express");
const app = express();
const os = require("os");
const cluster = require("cluster");
const clusterWorkerSize = os.cpus().length - 1;
const port = 3000;

let totalCalls = 0;
app.use(function (req, res, next) {
  res.setHeader("Content-type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  totalCalls++;
  if (totalCalls % 10000 == 0) {
    console.log("Total calls since reboot:", totalCalls);
  }
  next();
});

let cachedCalls = 0;

let axieData = {};
function getAxieDataFromCache(id) {
  return axieData[id];
}

function setDataInCache(id, doc) {
  if (
    !doc ||
    (doc.message &&
      (doc.message.match(/.*error.*/i) || doc.message.match(/.*timed.*/i)))
  ) {
    return false;
  }
  axieData[id] = doc;
  return true;
}

let axieGeneData = {};
let axieGeneAllData = {};
function getAxieGeneDataFromCache(id, allCache) {
  if (!allCache) return axieGeneData[id];
  else return axieGeneAllData[id];
}

function setDataInGeneCache(id, allCache, doc) {
  if (!allCache) axieGeneData[id] = doc;
  else axieGeneAllData[id] = doc;
}

app.get("/", (req, res) => {
  res.send("Hello World!");
});

async function getAxieDataFromLambdaPromise(axieId, timeout) {
  return new Promise((resolve, reject) => {
    let lambdaUrl = "1s9wo04jw3.execute-api.us-east-1.amazonaws.com";
    const options = {
      hostname: lambdaUrl,
      port: 443,
      path: "/prod/getaxies/" + axieId,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 50000,
    };

    const req = https.request(options, (res) => {
      var data = "";

      res.on("data", (d) => {
        data += d;
      });

      res.on("end", async () => {
        try {
          let doc = { message: "error" };

          try {
            doc = JSON.parse(data);
          } catch (ex) {
            //Nop.
          }

          if (
            !doc ||
            (doc.message &&
              (doc.message.match(/.*error.*/i) ||
                doc.message.match(/.*timed.*/i)))
          ) {
            // Try again.
            resolve(await invalidateThroughLambdaPromise(axieId));
            return;
          }

          resolve(doc);
        } catch (ex) {
          console.log("Exception parsing data from axie,", ex, data);
          resolve({ failed: true });
        }
      });
    });

    req.on("timeout", () => {
      req.abort();
      reject({ failed: true });
    });

    req.on("error", (error) => {
      console.log("Error in connection: ", error);
    });

    req.end();
  });
}

async function getAxieDataPromise(axieId) {
  return new Promise(async (res, rej) => {
    let cacheData = getAxieDataFromCache(axieId);
    try {
      if (cacheData) {
        cachedCalls++;
        res(cacheData);
      } else {
        let doc = await getAxieDataFromLambdaPromise(axieId);
        if (doc && !doc.failed) {
          if (setDataInCache(axieId, doc)) {
            process.send({
              type: "updateaxie",
              axieid: axieId,
              doc: JSON.stringify(doc),
            });
          }
        }

        res(doc);
      }
    } catch (ex) {
      console.log("Axie Data Exception:", axieId, ex);
      res({});
    }
  });
}

async function getAxieGeneDataFromLambdaPromise(axieId, addAll) {
  return new Promise((resolve, reject) => {
    let lambdaUrl = "1s9wo04jw3.execute-api.us-east-1.amazonaws.com";
    const options = {
      hostname: lambdaUrl,
      port: 443,
      path: "/prod/getgenes/" + axieId,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 50000,
    };

    if (addAll) {
      options.path = options.path + "/all";
    }

    const req = https.request(options, (res) => {
      var data = "";

      res.on("data", (d) => {
        data += d;
      });

      res.on("end", () => {
        try {
          let doc = JSON.parse(data);
          resolve(doc);
        } catch (ex) {
          console.log("Exception parsing data from axie,", ex, data);
          resolve({});
        }
      });
    });

    req.on("timeout", () => {
      req.abort();
      reject({});
    });

    req.on("error", (error) => {
      console.error(error);
    });

    req.end();
  });
}

async function getAxieGeneDataPromise(axieId, addAll) {
  return new Promise(async (res, rej) => {
    let cacheData = getAxieGeneDataFromCache(axieId, addAll);
    try {
      if (cacheData) {
        cachedCalls++;
        res(cacheData);
      } else {
        let doc = await getAxieGeneDataFromLambdaPromise(axieId, addAll);
        setDataInGeneCache(axieId, addAll, doc);
        res(doc);
      }
    } catch (ex) {
      console.log("Gene Data Exception:", ex, axieId, addAll);
      res({});
    }
  });
}

async function invalidateThroughLambdaPromise(axieId) {
  return new Promise((resolve, reject) => {
    let lambdaUrl = "1s9wo04jw3.execute-api.us-east-1.amazonaws.com";
    const options = {
      hostname: lambdaUrl,
      port: 443,
      path: "/prod/invalidateaxie/" + axieId,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 50000,
    };

    const req = https.request(options, (res) => {
      var data = "";

      res.on("data", (d) => {
        data += d;
      });

      res.on("end", () => {
        try {
          let doc = JSON.parse(data);
          resolve(doc);
        } catch (ex) {
          console.log("Exception parsing data from axie,", ex, data);
          resolve({});
        }
      });
    });

    req.on("timeout", () => {
      req.abort();
      reject({});
    });

    req.on("error", (error) => {
      console.error(error);
    });

    req.end();
  });
}

function parseAxies(axies) {
  let axieIds = [];
  if (axies.match(/,/)) {
    axieIds = axies.split(/,/);
  } else {
    if (Number.isNaN(axies - 0)) {
      //console.log("Bad axie id:", axies);
      axies = 1000001;
    }

    axieIds = [axies];
  }

  return axieIds;
}

app.get("/getaxies/", function (req, res) {
  res.send({ error: "noid" });
  return;
});

app.get("/getaxies/:axies", function (req, res, next) {
  if (!req.params || !req.params.axies) {
    res.send({ error: "noid" });
    return;
  }

  let axies = req.params.axies;

  if (!axies || axies == "" || axies == ",,") {
    res.send({ error: "noid" });
    return;
  }

  let axieIds = parseAxies(axies);

  let axiePromises = [];
  for (let i = 0; i < axieIds.length; i++) {
    axiePromises.push(getAxieDataPromise(axieIds[i]));
  }

  Promise.all(axiePromises)
    .then((values) => {
      if (values.length == 1) {
        res.send(values[0]);
      } else {
        res.send(values);
      }
    })
    .catch((ex) => {
      console.log("Exception in gataxies promises.", ex);
    });
});

function geneHandler(req, res, all) {
  let axies = req.params.axies;
  let addAll = false;
  if (all) {
    addAll = true;
  }

  if (!axies || axies == "" || axies == ",,") {
    res.send({ error: "noid" });
    return;
  }

  let axieIds = parseAxies(axies);

  let axiePromises = [];
  for (let i = 0; i < axieIds.length; i++) {
    axiePromises.push(getAxieGeneDataPromise(axieIds[i], addAll));
  }

  Promise.all(axiePromises)
    .then((values) => {
      if (values.length == 1) {
        res.send(values[0]);
      } else {
        res.send(values);
      }
    })
    .catch((ex) => {
      console.log("Exception in gatgenes promises.", ex);
    });
}

app.get("/getgenes/:axies", function (req, res, next) {
  geneHandler(req, res, false);
});

app.get("/getgenes/:axies/all", function (req, res, next) {
  geneHandler(req, res, true);
});

app.get("/invalidateaxie/:axie", function (req, res, next) {
  let axie = req.params.axie;
  invalidateThroughLambdaPromise(axie)
    .then((result) => {
      if (setDataInCache(axie, result)) {
        process.send({
          type: "invalidate",
          axieid: axie,
          doc: JSON.stringify(result),
        });
      }
      res.send(JSON.stringify(result));
    })
    .catch((ex) => {
      console.log("Exception in invalidate promises.", ex);
    });
});

app.get("/bugged/:axie/:price", function (req, res, next) {
  let axie = req.params.axie;
  let price = req.params.price - 0;
  getAxieDataPromise(axie).then((result) => {
    result.bugged = true;
    result.bugged_price = price;
    if (setDataInCache(axie, result)) {
      process.send({
        type: "bugged",
        axieid: axie,
        doc: JSON.stringify(result),
      });
    }
    res.send(JSON.stringify(result));
  })
  .catch((ex) => {
    console.log("Exception in invalidate promises.", ex);
  });
});


app.get("/stats", (req, res, next) => {
  let finalData = {};
  finalData.clusterId = cluster.worker.id;
  finalData.totalCalls = totalCalls;
  finalData.cachedCalls = cachedCalls;
  res.send(JSON.stringify(finalData, null, 2));
});

const start = async () => {
  try {
    app.listen(port, () => {
      console.log(`Example app listening at http://localhost:${port}`);
    });
  } catch (ex) {
    console.log("Process exit error.");
  }
};

let clusterMap = [];

function handleMsg(msg) {
  for (let i = 0; i < clusterMap.length; i++) {
    try {
      if (clusterMap[i]) clusterMap[i].send(msg);
    } catch (ex) {
      console.log("err:", ex);
    }
  }
}

if (clusterWorkerSize > 1) {
  if (cluster.isMaster) {
    for (let i = 0; i < clusterWorkerSize; i++) {
      const worker = cluster.fork();
      clusterMap[worker.id] = worker;

      worker.on("message", handleMsg);
    }

    cluster.on("exit", function (worker, code, signal) {
      console.log("Worker", worker.id, "has exited with signal", signal);
      if (code !== 0 && !worker.exitedAfterDisconnect) {
        const worker = cluster.fork();
        clusterMap[worker.id] = worker;
        worker.on("message", handleMsg);
      }
    });
  } else {
    start();
  }
} else {
  start();
}

process.on("message", (msg) => {
  setDataInCache(msg.axieid, JSON.parse(msg.doc));
});
