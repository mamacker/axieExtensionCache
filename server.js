const https = require("https");
const express = require("express");
const app = express();
const os = require("os");
const cluster = require("cluster");
const clusterWorkerSize = os.cpus().length - 1;
const port = 3000;

const graphql = require("graphql-request");
const gql = graphql.gql;
const GraphQLClient = graphql.GraphQLClient;

let blackList = [
];

let totalCalls = 0;
let axieIPs= {};
let origins= {};
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

  var ipAddress = req.header('x-forwarded-for') || req.connection.remoteAddress;
  if (!axieIPs[ipAddress]) {
    axieIPs[ipAddress] = 1;
  }
  axieIPs[ipAddress]++;

  let origin = req.header('origin');
  if (!origins[origin]) {
    origins[origin] = 1;
  }
  origins[origin]++;

  if (origin != undefined && origin.startsWith("chrome-extension")) {
    if (blackList.includes(origin)){
      if (Math.random() * 100 > 30) {
        res.send({});
        return;
      }
    }
  }

  next();
});

let cachedCalls = 0;

let axieData = {};
let axieCalls = {};
let startTime = Date.now();
function getAxieDataFromCache(id) {
  if (!axieCalls[id])
      axieCalls[id] = 0;

  axieCalls[id]++;
  return axieData[id];
}

function getSortedHash(inputHash){
  var resultHash = [];

  var keys = Object.keys(inputHash);
  keys.sort(function(a, b) {
    if (inputHash[a] < inputHash[b]) return -1
    if (inputHash[a] > inputHash[b]) return 1
    return 0;
  }).reverse().forEach(function(k) {
    resultHash.push(k)
  });
  return resultHash;
}

function topIDCalls() {
  let topSet = {};
  let sHash = getSortedHash(axieCalls);
  let count = 0;
  for (let i = 0; i < sHash.length; i++) {
    topSet[sHash[i]] = axieCalls[sHash[i]]
    count++;
    if (count > 100) break;
  }
  return topSet;
}

function topIPCalls() {
  let topSet = {};
  let sHash = getSortedHash(axieIPs);
  let count = 0;
  for (let i = 0; i < sHash.length; i++) {
    topSet[sHash[i]] = axieIPs[sHash[i]]
    count++;
    if (count > 50) break;
  }
  return topSet;
}

function setDataInCache(id, doc) {
  if (
    !doc || Object.keys(doc).length == 0 ||
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

async function getAxieDataFromLambdaPromise(axieId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      operationName: "GetAxieDetail",
      variables: {
        axieId: "" + axieId,
      },
      query:
        "query GetAxieDetail($axieId: ID!) {\n  axie(axieId: $axieId) {\n    ...AxieDetail\n    __typename\n  }\n}\n\nfragment AxieDetail on Axie {\n  id\n  name\n  genes\n  owner\n  birthDate\n  bodyShape\n  class\n  sireId\n  sireClass\n  matronId\n  matronClass\n  stage\n  title\n  breedCount\n  level\n  figure {\n    atlas\n    model\n    image\n    __typename\n  }\n  parts {\n    ...AxiePart\n    __typename\n  }\n  stats {\n    ...AxieStats\n    __typename\n  }\n  auction {\n    ...AxieAuction\n    __typename\n  }\n  ownerProfile {\n    name\n    __typename\n  }\n  children {\n    id\n    name\n    class\n    image\n    title\n    stage\n    __typename\n  }\n  __typename\n}\n\nfragment AxiePart on AxiePart {\n  id\n  name\n  class\n  type\n  stage\n  abilities {\n    ...AxieCardAbility\n    __typename\n  }\n  __typename\n}\n\nfragment AxieCardAbility on AxieCardAbility {\n  id\n  name\n  attack\n  defense\n  energy\n  description\n  backgroundUrl\n  effectIconUrl\n  __typename\n}\n\nfragment AxieStats on AxieStats {\n  hp\n  speed\n  skill\n  morale\n  __typename\n}\n\nfragment AxieAuction on Auction {\n  startingPrice\n  endingPrice\n  startingTimestamp\n  endingTimestamp\n  duration\n  timeLeft\n  currentPrice\n  currentPriceUSD\n  suggestedPrice\n  seller\n  listingIndex\n  __typename\n}\n",
    });

    const options = {
      hostname: "graphql-gateway.axieinfinity.com",
      port: 443,
      path: "/graphql?r=explorer",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
      }
    };

    const req = https.request(options, (res) => {
      var data = "";

      res.on("data", (d) => {
        data += d;
      });

      res.on("end", () => {
        let doc = { message: "error" };
        try {
          //console.log("Text from axie:", data);
          doc = JSON.parse(data);
          //console.log("Parse from axie:", doc);
          resolve(doc.data.axie);
        } catch (ex) {
          reject(doc);
        }
      });
    });

    req.on("error", (error) => {
      console.error(error);
    });

    req.write(data);
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
  return new Promise(async (res, rej) => {
    try {
      let doc = await getAxieDataFromLambdaPromise(axieId);
      setDataInCache(axieId, doc);
      res(doc);
    } catch (ex) {
      console.log("Invalidate Data Exception:", ex, axieId);
      res({});
    }
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
  res.send(JSON.stringify({}));

  var ipAddress = req.header('x-forwarded-for') || req.connection.remoteAddress;
  if (axieIPs[ipAddress] < 1000) {
    let axie = req.params.axie;
    // We no longer send results - in spite of invalidation.
    invalidateThroughLambdaPromise(axie)
      .then((result) => {
        if (setDataInCache(axie, result)) {
          process.send({
            type: "invalidate",
            axieid: axie,
            doc: JSON.stringify(result),
          });
        }
      })
      .catch((ex) => {
        console.log("Exception in invalidate promises.", ex);
      });
  }
  return;
});

app.get("/xaxie/:axie", function (req, res, next) {
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
  finalData.topIPs = topIPCalls();
  finalData.upTimeHours = (Date.now() - startTime) / 1000 / 60 / 60 ;
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
