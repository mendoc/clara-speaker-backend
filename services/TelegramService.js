import TelegramBot from "node-telegram-bot-api";
import { telegramConfig } from "../common/config";

export class TelegramService {
  constructor() {
    this.bot = new TelegramBot(telegramConfig.botToken, { polling: false });
  }

  async sendMessage(message) {
    try {
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