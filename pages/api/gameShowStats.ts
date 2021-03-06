import { Db } from 'mongodb';
import { NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import middleware from '../../middleware/db';
import { NextApiRequestWithDb } from '../../utils/NextRequestWithDbType';
import TimeFilter from '../../utils/timeFIlter';
import { timeSeriesCache, filterByTime } from './gameShowHistory';

const collectionName = 'evostats';

const handler = nextConnect();
handler.use(middleware);

type GameShowStatsResponse = {
  livePlayers: number;
  weekAvg: number;
  timeStamp: Date;
  ath: number
}

const getTimeSeries = async (db: Db) => {
  if (timeSeriesCache.expiryTimestamp && timeSeriesCache.expiryTimestamp.valueOf() > Date.now()) {
    return timeSeriesCache.value;
  }

  const now = new Date();
  const dateSevenDaysAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1).toISOString();
  const arr = await db.collection(collectionName).find({ "timeStamp": { $gt: dateSevenDaysAgo } }).toArray();
  const expiryTimestamp = new Date(now.getTime() + 1000 * 60 * 5);
  timeSeriesCache.expiryTimestamp = expiryTimestamp;

  timeSeriesCache.value = arr;
  return timeSeriesCache.value;
};

const getGameInfoByProp = async (prop: string, db: Db) => {
  const gameInfos = await db.collection("gameInfo").find().toArray();
  return gameInfos.find(h => h.game === prop)
}

const getStatsByProp = async (prop: string, db: Db) => {
  const timeFilteredResult = (await getTimeSeries(db))
    .map(a => ({ timeStamp: a.timeStamp, value: a.entry[prop] }))
    .filter(arr => filterByTime(arr, TimeFilter["7D"]))
    .filter(a => a.value);

  const weekAvg = Math.round(
    timeFilteredResult.reduce((total, obj) => total + obj.value, 0) / timeFilteredResult.length
  );
  const { ath } = await getGameInfoByProp(prop, db);

  return {
    livePlayers: timeFilteredResult[timeFilteredResult.length - 1].value,
    timeStamp: timeFilteredResult[timeFilteredResult.length - 1].timeStamp,
    weekAvg,
    ath
  };
};

const getStatsAllGames = async (db: Db): Promise<GameShowStatsResponse> => {
  const timeFilteredResult = (await getTimeSeries(db))
    .map(ts => {
      return {
        timeStamp: ts.timeStamp,
        value: ts.entry,
      };
    })
    .filter(arr => filterByTime(arr, TimeFilter["7D"]));

  const weekAvg = Math.round(
    timeFilteredResult.reduce((total, obj) => {
      const summedPLayers = Object.values(obj.value).reduce((res2, obj2) => res2 + obj2, 0);
      if (!summedPLayers) {
        return total;
      }
      return total + summedPLayers;
    }, 0) / timeFilteredResult.length
  );

  const livePlayers = Object.values(timeFilteredResult[timeFilteredResult.length - 1].value).reduce(
    (res, obj) => res + obj,
    0
  );
  const { ath } = await getGameInfoByProp("All Shows", db);

  return {
    livePlayers,
    weekAvg,
    timeStamp: timeFilteredResult[timeFilteredResult.length - 1].timeStamp,
    ath
  };
};

handler.get(async (req: NextApiRequestWithDb, res: NextApiResponse<GameShowStatsResponse>) => {
  const gameShow = req.query.gameShow as string;
  if (gameShow) {
    switch (gameShow) {
      case 'All Shows':
        return res.json(await getStatsAllGames(req.db));
      default:
        return res.json(await getStatsByProp(gameShow, req.db))
    }
  } else {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'Bad Request' }));
  }
});

export default handler;
