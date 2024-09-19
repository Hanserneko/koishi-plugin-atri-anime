import { Context, Schema, h, Logger, Session, Dict } from "koishi";

import { resolve } from "path";
import * as fs from "fs";
import * as path from "path";
export const usage = `## ANIME MASTER\n
可自己出题自己控制题库的动漫高手游戏插件\n
- **指令: anime.start**\n
    别名:开始游戏\n
    开始一局游戏\n
- **指令: anime.end**\n
    别名:结束游戏\n
    结束已经开始的游戏\n
- **指令: anime.set**\n
    别名:出题\n
    为游戏出题 仅可在私聊使用\n
- **指令: anime.reg**\n
    别名:注册群聊\n
    在群聊中开始游戏前需要注册群聊以记录游戏状态\n
- **指令: anime.delete**\n
    删除自己出过的题 还未实现
`;

export const name = "atri-anime";

export const inject = { required: ["database"], optional: [] };

export interface Config {
  hintWord: Array<string>;
  skipWord: Array<string>;
  endWord: Array<string>;
  defaultGameMinQues: number;
  defaultGameMaxQues: number;
}

export const Config: Schema<Config> = Schema.object({
  hintWord: Schema.array(String)
    .role("table")
    .default(["hint", "提示"])
    .description("要求给出提示的词"),
  skipWord: Schema.array(String)
    .role("table")
    .default(["skip", "跳过"])
    .description("要求跳过问题的词"),
  endWord: Schema.array(String)
    .role("table")
    .default(["结束", "结束游戏", "end game", "end"])
    .description("要求结束游戏的词"),
  defaultGameMinQues: Schema.number()
    .default(3)
    .min(1)
    .description("单局游戏最少问题数"),
  defaultGameMaxQues: Schema.number()
    .default(6)
    .min(1)
    .description("单局游戏最多问题数"),
});

declare module "koishi" {
  interface Tables {
    ani_mas_groups: ani_mas_groups;
  }
  interface Tables {
    ani_mas_ques: ani_mas_ques;
  }
}
export interface ani_mas_groups {
  id: number;
  group_id: string;
  is_start: boolean;
  order: number[];
  cur: number;
  hint_time: number;
  players: { [key: string]: number };
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
  ctx.model.extend(
    "ani_mas_groups",
    {
      id: "unsigned",
      group_id: "string",
      is_start: "boolean",
      order: "list",
      cur: "integer",
      hint_time: "integer",
      players: "json",
    },
    {
      autoInc: true,
    }
  );

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
  const logger = ctx.logger("ani-master");
  // 游戏内逻辑
  const current = {
    //开启新游戏
    async newGame(session: Session) {
      session.cancelQueued();
      const quesNames = anime_master.quesList;
      if (quesNames.length == 0) {
        await session.sendQueued("题库里没有题哦，快去出题吧");
        return { code: false, msg: "空题库" };
      }
      if (quesNames.length < cfg.defaultGameMinQues) {
        await session.sendQueued(
          `题库中题目数量少于${cfg.defaultGameMinQues}个，无法开始，快去出题吧`
        );
        return { code: false, msg: "题目不足" };
      }
      await session.sendQueued("动漫达人游戏开始");
      let quesOrder = getRandomArr(
        minNumber(quesNames.length, cfg.defaultGameMaxQues)
      );
      // console.info("题目编号" + quesNames);
      // console.info("题目顺序" + quesOrder);
      await ctx.database.set(
        "ani_mas_groups",
        { group_id: session.guildId },
        { is_start: true, order: quesOrder, cur: 0, players: {} }
      );
      this.newQues(session);
    },

    async newQues(session: Session) {
      session.cancelQueued();
      let data = (
        await ctx.database.get("ani_mas_groups", { group_id: session.guildId })
      ).reduce((acc, item) => {
        return { ...acc, ...item };
      }, {});
      let order = data["order"];
      let cur = data["cur"];
      let id = anime_master.quesList[order[cur]];
      const question = (
        await ctx.database.get("ani_mas_ques", { qid: id })
      ).reduce((acc, item) => {
        return { ...acc, ...item };
      }, {});
      // console.info(question);
      await ctx.database.set(
        "ani_mas_groups",
        { group_id: session.guildId },
        { hint_time: 0 }
      );
      const ques_img = path.join(
        ctx.baseDir,
        `data/anime_master/ques/${id}.png`
      );
      await session.sendQueued([
        `这是一道分值为${question["score"] * 4}的题`,
        h("image", { url: "file:///" + ques_img }),
      ]);
    },

    async checkInput(session: Session) {
      session.cancelQueued();

      let data = (
        await ctx.database.get("ani_mas_groups", { group_id: session.guildId })
      ).reduce((acc, item) => {
        return { ...acc, ...item };
      }, {});
      let id = anime_master.quesList[data["order"][data["cur"]]];
      let ques_data = (
        await ctx.database.get("ani_mas_ques", { qid: id })
      ).reduce((acc, item) => {
        return { ...acc, ...item };
      }, {});
      const message = session.content.replace(/<at id="[^"]+"\/>/, "").trim();
      if (cfg.endWord.includes(message)) {
        this.finishGame(session);
      } else if (
        message == ques_data["name"] ||
        ques_data["Other_ans"].includes(message)
      ) {
        await session.sendQueued([
          "回答正确",
          `答案是:${ques_data["name"]}`,
          h("image", {
            url:
              "file:///" +
              path.join(ctx.baseDir, `data/anime_master/ans/${id}.png`),
          }),
        ]);
        await ctx.sleep(1000);
        if (session.userId == ques_data["auther"]) {
          await session.sendQueued(
            "啊欧 你好像是出题人呢 自己答自己的题不会得分哦"
          );
        } else {
          const score = ques_data["score"] * (4 - data["hint_time"]);
          if (data["players"][session.userId]) {
            data["players"][session.userId] += score;
          } else {
            data["players"][session.userId] = score;
          }
          await session.sendQueued(`获得${score}分`);
          await ctx.database.set(
            "ani_mas_groups",
            { group_id: session.guildId },
            { players: data["players"] }
          );
        }
        await this.nextOrEnd(session);
      } else if (cfg.hintWord.includes(message)) {
        data["hint_time"]++;
        if (data["hint_time"] == 4) {
          await session.sendQueued(`答案是:${ques_data["name"]}`);
          await session.sendQueued(
            h("image", {
              url:
                "file:///" +
                path.join(ctx.baseDir, `data/anime_master/ans/${id}.png`),
            })
          );
          await ctx.sleep(1000);
          await session.sendQueued("你真菜");
          await this.nextOrEnd(session);
        } else {
          await session.sendQueued(ques_data[`hint_${data["hint_time"]}`]);
          await ctx.database.set(
            "ani_mas_groups",
            { group_id: session.guildId },
            { hint_time: data["hint_time"] }
          );
        }
      } else if (cfg.skipWord.includes(message)) {
        await this.nextOrEnd(session);
      } else {
        await session.sendQueued("答案不对哦");
      }
    },

    // 检测下一题或者结束游戏
    async nextOrEnd(session: Session) {
      let data = (
        await ctx.database.get("ani_mas_groups", { group_id: session.guildId })
      ).reduce((acc, item) => {
        return { ...acc, ...item };
      }, {});
      let order = data["order"];
      let cur = data["cur"];
      // 防止下一个消息提前发送
      await ctx.sleep(1000);
      cur++;
      if (cur == order.length) {
        this.finishGame(session);
      } else {
        await session.sendQueued("进入下一题~");
        await ctx.database.set(
          "ani_mas_groups",
          { group_id: session.guildId },
          { cur: cur }
        );
        this.newQues(session);
      }
    },

    async finishGame(session: Session) {
      await ctx.database.set(
        "ani_mas_groups",
        { group_id: session.guildId },
        { is_start: false }
      );
      await session.sendQueued("游戏结束");
      await session.sendQueued("排行榜未适配");
      // const sorted_players = Object.entries(
      //   (
      //     await ctx.database.get(
      //       "ani_mas_groups",
      //       { group_id: session.guildId },
      //       ["players"]
      //     )
      //   ).map((item) => item.players)[0]
      // ).sort((a, b) => b[1] - a[1]);
      // sorted_players.forEach(([player, score], index) => {
      //   session.sendQueued(`玩家${index + 1} : ${player} : ${score}`);
      // });
    },
  };
  const anime_master = {
    quesList: [],

    async initQuesList() {
      this.quesList = (await ctx.database.get("ani_mas_ques", {}, ["qid"])).map(
        (item) => item.qid
      );
      logger.info("题库载入完成");
      // console.info(this.quesList);
    },

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
        logger.error("下载数据为空");
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
    anime_master.initQuesList();
  });

  ctx
    .command("anime.start")
    .alias("开始游戏")
    .usage("开始一局游戏")
    .action(async ({ session }) => {
      if (!session.guildId) return "请在群聊使用该命令";

      const is_start = await ctx.database.get(
        "ani_mas_groups",
        {
          group_id: session.guildId,
        },
        ["is_start"]
      );

      if (is_start.length == 0) return "群组未注册 先去注册吧";

      if (is_start.map((item) => item.is_start)[0]) return "游戏正在进行中";

      await ctx.database.set(
        "ani_mas_groups",
        { group_id: session.guildId },
        { is_start: true }
      );
      session.cancelQueued();
      await anime_master.initQuesList();
      await current.newGame(session);
    });
  ctx
    .command("anime.end")
    .alias("结束游戏")
    .usage("结束已开始的游戏")
    .action(async ({ session }) => {
      if (!session.guildId) return "请在群聊使用该命令";

      if (
        (
          await ctx.database.get("ani_mas_groups", {
            group_id: session.guildId,
          })
        ).length == 0
      )
        return "群组未注册 先去注册吧";

      await ctx.database.set(
        "ani_mas_groups",
        { group_id: session.guildId },
        { is_start: false }
      );
    });
  ctx
    .command("anime.set")
    .alias("出题")
    .usage(
      "在私聊使用 使用后直接开始输入问题编号(有时第一句发不出来) 之后按提示输入即可 电脑端发送图片请使用聊天栏中的图片发送 移动端发送图片请使用转发功能(但不要从我的电脑那里转发)"
    )
    .action(async ({ session }) => {
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
      // console.log(quesList);
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
      logger.success(
        `题目保存:T 谜面保存:${save_ques.msg} 谜底保存:${save_ans.msg}`
      );
      await session.sendQueued("出题成功");
    });

  ctx.command("anime.delete").action(async ({ session }) => {
    if (session.guildId) {
      return "请通过私聊删除题目";
    }
  });

  ctx
    .command("anime.reg")
    .alias("注册群聊")
    .usage("在一个群聊初次使用时需要使用此命令注册群聊")
    .action(async ({ session }) => {
      if (session.guildId) {
        if (
          (
            await ctx.database.get("ani_mas_groups", {
              group_id: session.guildId,
            })
          ).length != 0
        ) {
          return "群组已存在 请勿重复注册";
        } else {
          ctx.database.create("ani_mas_groups", {
            group_id: session.guildId,
            is_start: false,
          });
          return "群组注册完成";
        }
      } else {
        return "请在群聊使用该命令";
      }
    });

  ctx.middleware(async (session, next) => {
    if (
      (
        await ctx.database.get(
          "ani_mas_groups",
          {
            group_id: session.guildId,
          },
          ["is_start"]
        )
      ).map((item) => item.is_start)[0]
    ) {
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
