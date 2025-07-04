import TelegramBot from "node-telegram-bot-api";
import { telegramConfig } from "../common/config";

export class TelegramService {
  private bot: TelegramBot;

  constructor() {
    if (!telegramConfig.botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is not defined in config.");
    }
    this.bot = new TelegramBot(telegramConfig.botToken, { polling: false });
  }

  async sendMessage(message: string): Promise<void> {
    try {
      if (!telegramConfig.chatId) {
        throw new Error("TELEGRAM_CHAT_ID is not defined in config.");
      }
      await this.bot.sendMessage(telegramConfig.chatId, message, {
        parse_mode: "HTML",
      });
    } catch (error) {
      console.error(
        "[sendMessage@TelegramService]",
        "Erreur lors de l'envoi du message:",
        error
      );
    }
  }
}