import { Context, Schema, h, Logger, Session } from "koishi";
import {} from "koishi-plugin-smmcat-localstorage";
import { resolve } from "path";
import * as fs from "fs";
import * as path from "path";

export const name = "atri-anime";

export const inject = ["localstorage"];

export interface Config {
  defaultImageExtension: string;
}

export const Config: Schema<Config> = Schema.object({
  defaultImageExtension: Schema.string()
    .description("默认图片保存后缀")
    .default("png"),
});

export function apply(ctx: Context, cfg: Config) {
  // write your plugin here
  var isstarted = false;
  const current = {
    question: {},
    score: {},
    hint_time: 0,

    async init() {
      this.question = {};
      this.score = {};
      this.hint_time = 0;
    },

    async newQues(ques, session: Session) {
      this.question = anime_master.quesList[ques];
      this.quesId = this.question.id;
      const ques_img = path.join(
        ctx.baseDir,
        `data/anime_master/ques/${ques}.png`
      );
      await session.send(h("image", { url: "file:///" + ques_img }));
      console.info(this.question);
    },

    async checkInput(session: Session) {
      const message = session.content.replace(/<at id="[^"]+"\/>/, "").trim();
      if (message == this.question.name) {
        isstarted = false;
        await session.sendQueued("回答正确");
        await session.sendQueued(
          h("image", {
            url:
              "file:///" +
              path.join(
                ctx.baseDir,
                `data/anime_master/ans/${this.question.id}.png`
              ),
          })
        );
      }
      if (message == "hint" || message == "提示") {
        this.hint_time++;
        if (this.hint_time == 4) {
          isstarted = false;
          await session.sendQueued(`答案是:${this.question.name}`);
          await session.sendQueued(
            h("image", {
              url:
                "file:///" +
                path.join(
                  ctx.baseDir,
                  `data/anime_master/ans/${this.question.id}.png`
                ),
            })
          );
          await session.sendQueued("你真菜");
        } else {
          await session.sendQueued(this.question[`hint_${this.hint_time}`]);
        }
      }
    },
  };
  const anime_master = {
    userList: {},
    quesList: {},

    //初始化userlist
    async initUserList() {
      const data = JSON.parse(
        (await ctx.localstorage.getItem("anime_master/all_user")) || "[]"
      );
      const userList = this.userList;
      const dic = { success: 0, err: 0 };
      const eventList = data.map((item) => {
        return new Promise(async (resolve, reject) => {
          try {
            userList[item] = JSON.parse(
              await ctx.localstorage.getItem(`anime_master/${item}`)
            );
            dic.success++;
            resolve(true);
          } catch (error) {
            dic.err++;
            reject(false);
          }
        });
      });
      await Promise.all(eventList);
      console.info(`初始化完成 成功:${dic.success} 失败:${dic.err}`);
      console.info("注册人数:" + eventList.length);
    },

    async initQuesList() {
      const data = JSON.parse(
        (await ctx.localstorage.getItem("anime_master/questions")) || "[]"
      );
      const quesList = this.quesList;
      const dic = { success: 0, err: 0 };
      const eventList = data.map((item) => {
        return new Promise(async (resolve, reject) => {
          try {
            quesList[item] = JSON.parse(
              await ctx.localstorage.getItem(`anime_master/ques/${item}`)
            );
            dic.success++;
            resolve(true);
          } catch (error) {
            dic.err++;
            reject(false);
          }
        });
      });
      await Promise.all(eventList);
      console.info(`题库加载 成功:${dic.success} 失败:${dic.err}`);
      console.info("题目数量:" + eventList.length);
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

    async userSetStore(userId) {
      await ctx.localstorage.setItem(
        "anime_master/all_user",
        JSON.stringify(Object.keys(this.userList))
      );
      await ctx.localstorage.setItem(
        `anime_master/${userId}`,
        JSON.stringify(this.userList[userId])
      );
    },

    async quesSetStore(quesId) {
      await ctx.localstorage.setItem(
        "anime_master/questions",
        JSON.stringify(Object.keys(this.quesList))
      );
      await ctx.localstorage.setItem(
        `anime_master/ques/${quesId}`,
        JSON.stringify(this.quesList[quesId])
      );
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

  ctx.on("ready", () => {
    anime_master.initUserList();
    anime_master.initQuesList();
  });

  ctx.command("anime <mode:string>").action(async ({ session }, mode) => {
    if (mode == "测试") {
      if (isstarted == true) {
        return "测试已开始";
      }
      isstarted = true;
      console.info(session.event.user);
      if (session.guildId) {
        console.info(session.guildId);
      }

      await session.sendQueued("测试开始");
    }
    if (mode == "结束") {
      if (isstarted == false) {
        return "测试未开始";
      }
      isstarted = false;
      await session.sendQueued("测试结束");
    }
  });

  ctx.command("anime.up <data>").action(async ({ session }, data) => {
    const id = session.event.user.id;
    await ctx.localstorage.setItem(id, data);
    await session.sendQueued("成功");
  });

  ctx.command("anime.out").action(async ({ session }) => {
    const id = session.event.user.id;
    const result = await ctx.localstorage.getItem(id);
    console.info(result);
    await session.sendQueued("数据:\n" + result);
  });

  ctx.command("存数据 <str>").action(async ({ session }, str) => {
    await ctx.localstorage.setItem("myData", str);
    await session.sendQueued("存储成功");
  });

  ctx.command("取数据").action(async ({ session }) => {
    const result = await ctx.localstorage.getItem("myData");
    await session.sendQueued("数据为：\n" + result);
  });

  ctx.command("anime.注册").action(async ({ session }) => {
    anime_master.checkAndCreateUserInfo(session.userId);
    anime_master.userSetStore(session.userId);
    session.sendQueued("注册成功");
  });

  ctx.command("anime.check").action(async ({ session }) => {
    const result = anime_master.getScore(session.userId);
    session.sendQueued(result.msg);
  });

  ctx
    .command("anime.出题")
    .option("ext", "-e [ext:string]")
    .action(async ({ session, options }) => {
      if (session.guildId) {
        return "请通过私聊进行出题";
      }

      await anime_master.initQuesList();
      const imageExtension = options.ext || cfg.defaultImageExtension;
      const quesList = anime_master.quesList;
      const user_id = session.event.user.id;

      await session.sendQueued("请输入问题编号");
      let filename = await session.prompt();
      if (!filename) {
        return "time out";
      }
      console.info(anime_master.quesList);

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
      const ques = await session.prompt();
      if (!ques) {
        return "time out";
      }

      await session.sendQueued("请发送谜底图片");
      const ans = await session.prompt();
      if (!ans) {
        return "time out";
      }

      await session.sendQueued("请输入提示-1(角色特征或台词等)");
      const hint_1 = await session.prompt();
      if (!hint_1) {
        return "time out";
      }
      await session.sendQueued("请输入提示-2(角色登场作品等)");
      const hint_2 = await session.prompt();
      if (!hint_2) {
        return "time out";
      }
      await session.sendQueued("请输入提示-3(角色名称提示等)");
      const hint_3 = await session.prompt();
      if (!hint_3) {
        return "time out";
      }

      quesList[filename] = {
        name: name,
        id: filename,
        auther: user_id,
        hint_1: hint_1,
        hint_2: hint_2,
        hint_3: hint_3,
      };
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
      anime_master.quesSetStore(filename);
      await session.sendQueued("出题成功");
    });

  ctx.command("anime.update").action(async ({ session }) => {
    anime_master.initUserList();
    await session.sendQueued("更新完成");
  });

  ctx.command("anime.test").action(async ({ session }) => {
    isstarted = true;
    current.newQues("atri01", session);
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
