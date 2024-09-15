import { Context, Schema, h, Logger, Session } from "koishi";
import {} from "koishi-plugin-smmcat-localstorage";
import { resolve } from "path";
import * as fs from "fs";
import * as path from "path";

export const name = "atri-anime";

export const inject = ["localstorage", "database"];

export interface Config {
  defaultGameMinQues: number;
  defaultGameMaxQues: number;
}

export const Config: Schema<Config> = Schema.object({
  defaultGameMinQues: Schema.number()
    .description("单局游戏最少问题数")
    .default(3)
    .min(1),
  defaultGameMaxQues: Schema.number()
    .description("单局游戏最多问题数")
    .default(6)
    .min(1),
}).i18n({
  "zh-CN": require("./locales/zh-CN"),
});

declare module "koishi" {
  interface Tables {
    ani_master: ani_master;
  }
  interface Tables {
    ani_mas_ques: ani_mas_ques;
  }
}
export interface ani_master {
  id: number;
  userid: string;
}
export interface ani_mas_ques {
  id: number;
  qid: string;
  name: string;
  auther: string;
  hint_1: string;
  hint_2: string;
  hint_3: string;
  Other_ans: string[];
  score: number;
}
export function apply(ctx: Context, cfg: Config) {
  // ctx.model.extend(
  //   "ani_master",
  //   { id: "unsigned", userid: "string" },
  //   {
  //     autoInc: true,
  //   }
  // );

  // 题库数据库实现
  ctx.model.extend(
    "ani_mas_ques",
    {
      id: "unsigned",
      qid: "string",
      name: "string",
      auther: "string",
      hint_1: "string",
      hint_2: "string",
      hint_3: "string",
      Other_ans: "list",
      score: "integer",
    },
    { autoInc: true }
  );

  // 日志输出
  const logger = ctx.logger("ani-mas");

  var isstarted = false;

  // 游戏内逻辑
  const current = {
    question: {},
    players: {},
    score: {},
    hint_time: 0,
    quesNames: [],
    quesOrder: [],
    currentQues: 0,

    // 初始化游戏
    async init() {
      this.question = {};
      this.score = {};
      this.hint_time = 0;
      this.currentQues = 0;
    },

    //开启新游戏
    async newGame(session: Session) {
      this.init();
      session.cancelQueued();
      this.quesNames = anime_master.quesList;
      if (this.quesNames.length == 0) {
        await session.sendQueued("题库里没有题哦，快去出题吧");
        return { code: false, msg: "空题库" };
      }
      if (this.quesNames.length < cfg.defaultGameMinQues) {
        await session.sendQueued(
          `题库中题目数量少于${cfg.defaultGameMinQues}个，无法开始，快去出题吧`
        );
        return { code: false, msg: "题目不足" };
      }
      await session.sendQueued("动漫达人游戏开始");
      this.quesOrder = getRandomArr(
        minNumber(this.quesNames.length, cfg.defaultGameMaxQues)
      );
      console.info("题目编号" + this.quesNames);
      console.info("题目顺序" + this.quesOrder);
      isstarted = true;
      this.newQues(this.quesNames[this.quesOrder[0]], session);
    },

    async newQues(ques, session: Session) {
      session.cancelQueued();
      this.question = (
        await ctx.database.get("ani_mas_ques", { qid: ques })
      ).reduce((acc, item) => {
        return { ...acc, ...item };
      }, {});
      console.info(this.question);
      this.hint_time = 0;
      const ques_img = path.join(
        ctx.baseDir,
        `data/anime_master/ques/${ques}.png`
      );
      await session.sendQueued([
        `这是一道分值为${this.question["score"] * 4}的题`,
        h("image", { url: "file:///" + ques_img }),
      ]);
      console.info(this.question);
    },

    async checkInput(session: Session) {
      session.cancelQueued();
      const message = session.content.replace(/<at id="[^"]+"\/>/, "").trim();
      if (
        message == this.question.name ||
        this.question.Other_ans.includes(message)
      ) {
        await session.sendQueued([
          "回答正确",
          `答案是:${this.question.name}`,
          h("image", {
            url:
              "file:///" +
              path.join(
                ctx.baseDir,
                `data/anime_master/ans/${this.question.qid}.png`
              ),
          }),
        ]);
        await ctx.sleep(1000);
        if (!this.players.hasOwnProperty(session.userId)) {
          await session.sendQueued(
            "啊欧 你好像没有加入游戏呢 下次开始游戏前加入才能得分哦"
          );
        } else if (session.userId == this.question["auther"]) {
          await session.sendQueued(
            "啊欧 你好像是出题人呢 自己答自己的题不会得分哦"
          );
        } else {
          const score = this.question.score * (4 - this.hint_time);
          this.players[session.userId] += score;
          await session.sendQueued(`获得${score}分`);
        }
        await this.nextOrEnd(session);
      } else if (message == "hint" || message == "提示" || message == "不会") {
        this.hint_time++;
        if (this.hint_time == 4) {
          await session.sendQueued(`答案是:${this.question.name}`);
          await session.sendQueued(
            h("image", {
              url:
                "file:///" +
                path.join(
                  ctx.baseDir,
                  `data/anime_master/ans/${this.question.qid}.png`
                ),
            })
          );
          await ctx.sleep(1000);
          await session.sendQueued("你真菜");
          await this.nextOrEnd(session);
        } else {
          await session.sendQueued(this.question[`hint_${this.hint_time}`]);
        }
      } else {
        await session.sendQueued("答案不对哦");
      }
    },

    // 检测下一题或者结束游戏
    async nextOrEnd(session: Session) {
      // 防止下一个消息提前发送
      await ctx.sleep(1000);
      this.currentQues++;
      if (this.currentQues == this.quesOrder.length) {
        isstarted = false;
        this.finishGame(session);
      } else {
        await session.sendQueued("进入下一题~");
        this.newQues(this.quesNames[this.quesOrder[this.currentQues]], session);
      }
    },

    async finishGame(session: Session) {
      await session.sendQueued("游戏结束");
      await session.sendQueued("排行榜暂未实现");
      this.players = {};
    },
  };
  const anime_master = {
    userList: {},
    quesList: [],

    //初始化userlist
    // async initUserList() {
    //   const data = JSON.parse(
    //     (await ctx.localstorage.getItem("anime_master/all_user")) || "[]"
    //   );
    //   const userList = this.userList;
    //   const dic = { success: 0, err: 0 };
    //   const eventList = data.map((item) => {
    //     return new Promise(async (resolve, reject) => {
    //       try {
    //         userList[item] = JSON.parse(
    //           await ctx.localstorage.getItem(`anime_master/${item}`)
    //         );
    //         dic.success++;
    //         resolve(true);
    //       } catch (error) {
    //         dic.err++;
    //         reject(false);
    //       }
    //     });
    //   });
    //   await Promise.all(eventList);
    //   console.info(`初始化完成 成功:${dic.success} 失败:${dic.err}`);
    //   console.info("注册人数:" + eventList.length);
    // },

    async initQuesList() {
      this.quesList = (await ctx.database.get("ani_mas_ques", {}, ["qid"])).map(
        (item) => item.qid
      );

      console.info(this.quesList);
    },

    checkAndCreateUserInfo(userId) {
      if (!this.userList[userId]) {
        this.userList[userId] = {
          score: 0,
        };
      }
    },

    getScore(userId) {
      this.checkAndCreateUserInfo(userId);
      const score = this.userList[userId].score;
      return {
        code: true,
        msg: `你的分数:${score}`,
      };
    },

    // async userSetStore(userId) {
    //   await ctx.localstorage.setItem(
    //     "anime_master/all_user",
    //     JSON.stringify(Object.keys(this.userList))
    //   );
    //   await ctx.localstorage.setItem(
    //     `anime_master/${userId}`,
    //     JSON.stringify(this.userList[userId])
    //   );
    // },

    // async quesSetStore(quesId) {
    //   await ctx.localstorage.setItem(
    //     "anime_master/questions",
    //     JSON.stringify(Object.keys(this.quesList))
    //   );
    //   await ctx.localstorage.setItem(
    //     `anime_master/ques/${quesId}`,
    //     JSON.stringify(this.quesList[quesId])
    //   );
    // },

    async saveImage(
      imageStr: string,
      imageExtension: string,
      savePath: string,
      fileName: string
    ) {
      const filePath = path.join(savePath, fileName);
      // console.info(filePath);

      const img = h.select(imageStr, "img").map((item) => item.attrs.src);
      const buffer = await ctx.http.get(img[0]);
      if (buffer.byteLength == 0) {
        console.info("下载数据为空");
        return { code: false, msg: "error" };
      }
      await fs.promises.writeFile(
        `${filePath}.${imageExtension}`,
        Buffer.from(buffer)
      );
      return { code: true, msg: "成功" };
    },
  };
  function getRandomArr(num: number): number[] {
    var array: number[] = new Array();

    var i: number;
    for (i = 0; i < num; i++) {
      array[i] = i;
    }
    // 打乱数组顺序
    array.sort(function () {
      return 0.5 - Math.random();
    });

    return array;
  }

  function minNumber(num_A: number, num_B: number): number {
    if (num_A < num_B) {
      return num_A;
    } else {
      return num_B;
    }
  }

  // 插件启动时自动初始化
  ctx.on("ready", () => {
    // anime_master.initUserList();
    anime_master.initQuesList();
  });

  ctx.command("anime <mode:string>").action(async ({ session }, mode) => {
    if (mode == "测试") {
      if (isstarted == true) {
        return "测试已开始";
      }
      isstarted = true;
      session.cancelQueued();
      await session.sendQueued("测试开始");

      anime_master.initQuesList();
      current.newGame(session);
    }
    if (mode == "结束") {
      if (isstarted == false) {
        return "测试未开始";
      }
      isstarted = false;
      await session.sendQueued("测试结束");
    }
  });

  ctx.command("anime.出题").action(async ({ session }) => {
    if (session.guildId) {
      return "请通过私聊进行出题";
    }

    await anime_master.initQuesList();
    const imageExtension = "png";
    const quesList = anime_master.quesList;
    const user_id = session.userId;

    await session.sendQueued("请输入问题编号");
    let filename = await session.prompt();
    if (!filename) {
      return "time out";
    }

    while (quesList.hasOwnProperty(filename)) {
      await session.sendQueued("编号已存在 重新输入");
      filename = await session.prompt();
      if (!filename) {
        return "time out";
      }
    }

    await session.sendQueued("请输入角色名称");
    const name = await session.prompt();
    if (!name) {
      return "time out";
    }

    await session.sendQueued("请发送谜面图片");
    const ques = await session.prompt(60000);
    if (!ques) {
      return "time out";
    }

    await session.sendQueued("请发送谜底图片");
    const ans = await session.prompt(60000);
    if (!ans) {
      return "time out";
    }

    await session.sendQueued("请输入提示-1(建议:角色特征或台词等)");
    const hint_1 = await session.prompt();
    if (!hint_1) {
      return "time out";
    }
    await session.sendQueued("请输入提示-2(建议:角色登场作品等)");
    const hint_2 = await session.prompt();
    if (!hint_2) {
      return "time out";
    }
    await session.sendQueued("请输入提示-3(建议:角色名称提示等)");
    const hint_3 = await session.prompt();
    if (!hint_3) {
      return "time out";
    }
    let otherAnswers: string[] = [];
    await session.sendQueued(
      "请输入其他被认为是正确答案的名字 可持续输入 发送“end”以结束输入"
    );
    while (true) {
      const otherName = await session.prompt();
      if (!otherName) {
        return "time out";
      }
      if (otherName == "end") {
        break;
      }
      if (otherAnswers.includes(otherName) || otherName == name) {
        await session.sendQueued("已有该答案");
        continue;
      }
      otherAnswers.push(otherName);
      await session.sendQueued("答案记录成功");
    }
    await session.sendQueued("请输入该问题分值([1]简单~[3]中等~[5]困难)");
    var score = +(await session.prompt());
    while (isNaN(score) || score < 1 || score > 5) {
      await session.sendQueued("输入不合规 请重新输入");
      score = +(await session.prompt());
    }
    // quesList[filename] = {
    //   name: name,
    //   id: filename,
    //   auther: user_id,
    //   hint_1: hint_1,
    //   hint_2: hint_2,
    //   hint_3: hint_3,
    //   otherAnswers: otherAnswers,
    //   score: score,
    // };
    ctx.database.create("ani_mas_ques", {
      qid: filename,
      name: name,
      auther: user_id,
      hint_1: hint_1,
      hint_2: hint_2,
      hint_3: hint_3,
      Other_ans: otherAnswers,
      score: score,
    });
    console.log(quesList);
    const save_ques = await anime_master.saveImage(
      ques,
      imageExtension,
      "data/anime_master/ques",
      filename
    );
    const save_ans = await anime_master.saveImage(
      ans,
      imageExtension,
      "data/anime_master/ans",
      filename
    );
    await session.sendQueued(
      `谜面保存:${save_ques.msg} 谜底保存:${save_ans.msg}`
    );
    // anime_master.quesSetStore(filename);
    await session.sendQueued("出题成功");
  });

  ctx.command("anime.update").action(async ({ session }) => {
    // anime_master.initUserList();
    anime_master.initQuesList();
    await session.sendQueued("更新完成");
  });

  ctx.command("anime.test").action(async ({ session }) => {});

  ctx.command("anime.join").action(async ({ session }) => {
    const player = session.userId;
    console.info(current.players);
    if (isstarted) {
      return "一局游戏正在进行中 请等待游戏结束再加入";
    }
    if (player in current.players) {
      return "您已在准备中了哦";
    }
    current.players[player] = 0;
    return "已加入准备队列";
  });
  ctx.middleware(async (session, next) => {
    if (isstarted) {
      const message = session.content.replace(/<at id="[^"]+"\/>/, "").trim();
      if (message.startsWith("anime")) {
        return next();
      } else {
        return current.checkInput(session);
      }
    } else {
      return next();
    }
  }, true);
}
