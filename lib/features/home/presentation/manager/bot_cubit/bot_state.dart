part of 'bot_cubit.dart';

/// Base state for BotCubit extending Equatable.
abstract class BotState extends Equatable {
  const BotState();

  @override
  List<Object?> get props => [];
}

class BotInitial extends BotState {
  const BotInitial();
}

class BotLoading extends BotState {
  const BotLoading();
}

class BotWaitingForResponse extends BotState {
  final List<ChatMessageModel> messages;

  const BotWaitingForResponse(this.messages);

  @override
  List<Object?> get props => [messages];
}

class BotMessageSent extends BotState {
  final List<ChatMessageModel> messages;

  const BotMessageSent(this.messages);

  @override
  List<Object?> get props => [messages];
}

class BotFailure extends BotState {
  final String errMessage;

  const BotFailure(this.errMessage);

  @override
  List<Object?> get props => [errMessage];
}
