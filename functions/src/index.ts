import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as request from 'request';
import { load } from 'cheerio';

// Start writing Firebase Functions
// https://firebase.google.com/docs/functions/typescript

admin.initializeApp();

const getResponseBody = (uri: string) =>
   new Promise<any>((resolve, reject) => {
     request.get(uri, (err, res) => {
       if (err) reject(err);
       resolve(res.body);
     });
   });

const fetchLottoDrawNumber = async (drawId: number) =>
   await getResponseBody('https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=' + drawId);

const parseLottoDrawInfo = async (drawId: number) => {
  const result: { rank: number; totAmount: number; eachAmount: number; rankCount: number; }[] = [];
  const html = await getResponseBody('https://dhlottery.co.kr/gameResult.do?method=byWin&drwNo=' + drawId);
  const $ = load(html);
  const trs = $('.tbl_data tbody tr');
  trs.each((index, element) => {
    const tds = $(element).find('td');
    const rowData = {rank: index + 1, totAmount: 0, eachAmount: 0, rankCount: 0};
    tds.each((tdi, td) => {
      if (tdi === 1) {
        rowData.totAmount = Number($(td).text().replace(/[^0-9]/g, ''));
      } else if (tdi === 2) {
        rowData.rankCount = Number($(td).text().replace(/[^0-9]/g, ''));
      } else if (tdi === 3) {
        rowData.eachAmount = Number($(td).text().replace(/[^0-9]/g, ''));
      }
    });

    result.push(rowData);
  });

  return result;
}

const scrapLotto = async () => {
  const collectionReference = admin.firestore().collection('draws');

  let maxDrawId = 0;
  let totalSellAmount = 0;
  const maxDraw = collectionReference.orderBy('id', 'desc').limit(1);
  await maxDraw.get().then(snapshot => {
    snapshot.forEach((doc) => {
      const documentData = doc.data();
      maxDrawId = Number(documentData.id);
      totalSellAmount = Number(documentData.totalSellAmount);
    });
  });

  if (totalSellAmount == 0) {
    maxDrawId--;
  }

  while (true) {
    maxDrawId++;

    const result = await fetchLottoDrawNumber(maxDrawId);
    const resultJson = JSON.parse(result);

    if (resultJson.returnValue && resultJson.returnValue === 'fail') {
      break;
    }

    const rankAmount = await parseLottoDrawInfo(maxDrawId);

    await collectionReference.doc(maxDrawId.toString()).set({
      id: resultJson.drwNo,
      drawDate: resultJson.drwNoDate,
      winNumbers: [
        resultJson.drwtNo1,
        resultJson.drwtNo2,
        resultJson.drwtNo3,
        resultJson.drwtNo4,
        resultJson.drwtNo5,
        resultJson.drwtNo6,
        resultJson.bnusNo,
      ],
      totalSellAmount: resultJson.totSellamnt,
      totalFirstPrizeAmount: resultJson.firstAccumamnt,
      eachFirstPrizeAmount: resultJson.firstWinamnt,
      firstPrizewinnerCount: resultJson.firstPrzwnerCo,
      rankAmount: rankAmount,
    });
  }
}

export const scheduledScrapLotto
   = functions
   .region('asia-northeast1')
   .pubsub
   .schedule('*/10 21-22 * * 6')
   .timeZone('Asia/Seoul')
   .onRun(async (context) => {
     await scrapLotto();
     return null;
   });

export const httpScrapLotto
   = functions
   .region('asia-northeast1')
   .https.onRequest(async (req, resp) => {
     await scrapLotto();
     resp.send('done');
   });
