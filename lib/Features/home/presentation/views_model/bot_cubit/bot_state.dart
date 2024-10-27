import 'package:dash_chat_2/dash_chat_2.dart';

abstract class BotState {}

class BotInitial extends BotState {}

class BotLoading extends BotState {}

class BotMessageSent extends BotState {
  final List<ChatMessage> messages;
  BotMessageSent(this.messages);
}

class BotError extends BotState {
  final String message;
  BotError(this.message);
}
