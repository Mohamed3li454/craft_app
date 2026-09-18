import 'package:equatable/equatable.dart';

/// Role / Identity of the message sender.
enum AgentSender {
  user,
  assistant,
  system,
  tool;

  static AgentSender fromString(String value) {
    switch (value.toLowerCase()) {
      case 'user':
        return AgentSender.user;
      case 'assistant':
      case 'bot':
      case 'model':
        return AgentSender.assistant;
      case 'system':
        return AgentSender.system;
      case 'tool':
        return AgentSender.tool;
      default:
        return AgentSender.user;
    }
  }

  String get asString => name;
}

/// Lifecycle status of an Agent run.
enum AgentRunStatus {
  received,
  processing,
  waitingForConfirmation,
  executingTool,
  completed,
  failed,
  cancelled;

  static AgentRunStatus fromString(String value) {
    switch (value.toLowerCase()) {
      case 'received':
        return AgentRunStatus.received;
      case 'processing':
      case 'planning':
        return AgentRunStatus.processing;
      case 'waiting_for_confirmation':
      case 'waitingforconfirmation':
        return AgentRunStatus.waitingForConfirmation;
      case 'executing_tool':
      case 'executingtool':
      case 'calling_tool':
        return AgentRunStatus.executingTool;
      case 'completed':
        return AgentRunStatus.completed;
      case 'failed':
        return AgentRunStatus.failed;
      case 'cancelled':
        return AgentRunStatus.cancelled;
      default:
        return AgentRunStatus.processing;
    }
  }
}

/// Represents the state of a tool call triggered by the Agent.
class ToolCallState extends Equatable {
  final String id;
  final String toolName;
  final Map<String, dynamic> arguments;
  final String status; // 'started', 'completed', 'failed'
  final dynamic result;
  final String? errorMessage;

  const ToolCallState({
    required this.id,
    required this.toolName,
    this.arguments = const {},
    required this.status,
    this.result,
    this.errorMessage,
  });

  factory ToolCallState.fromJson(Map<String, dynamic> json) {
    return ToolCallState(
      id: (json['id'] ?? json['tool_call_id'] ?? '').toString(),
      toolName: (json['tool_name'] ?? json['name'] ?? json['toolName'] ?? '').toString(),
      arguments: json['arguments'] is Map
          ? Map<String, dynamic>.from(json['arguments'] as Map)
          : {},
      status: (json['status'] ?? 'started').toString(),
      result: json['result'] ?? json['output'],
      errorMessage: json['error_message'] ?? json['error'],
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'toolName': toolName,
        'arguments': arguments,
        'status': status,
        if (result != null) 'result': result,
        if (errorMessage != null) 'errorMessage': errorMessage,
      };

  @override
  List<Object?> get props => [id, toolName, arguments, status, result, errorMessage];
}

/// Represents a confirmation request for high-risk actions.
class ConfirmationRequest extends Equatable {
  final String id;
  final String agentRunId;
  final String actionName;
  final String description;
  final Map<String, dynamic> payload;
  final String token;
  final String status; // 'pending', 'approved', 'rejected', 'expired'
  final DateTime expiresAt;

  const ConfirmationRequest({
    required this.id,
    required this.agentRunId,
    required this.actionName,
    required this.description,
    this.payload = const {},
    required this.token,
    this.status = 'pending',
    required this.expiresAt,
  });

  bool get isExpired => DateTime.now().isAfter(expiresAt);
  bool get isPending => status == 'pending' && !isExpired;

  factory ConfirmationRequest.fromJson(Map<String, dynamic> json) {
    DateTime parsedExpiry = DateTime.now().add(const Duration(minutes: 5));
    if (json['expires_at'] != null) {
      parsedExpiry = DateTime.tryParse(json['expires_at'].toString()) ?? parsedExpiry;
    }

    return ConfirmationRequest(
      id: (json['id'] ?? json['confirmation_id'] ?? '').toString(),
      agentRunId: (json['agent_run_id'] ?? json['agentRunId'] ?? '').toString(),
      actionName: (json['action_name'] ?? json['actionName'] ?? '').toString(),
      description: (json['description'] ?? json['message'] ?? '').toString(),
      payload: json['payload'] is Map
          ? Map<String, dynamic>.from(json['payload'] as Map)
          : {},
      token: (json['token'] ?? '').toString(),
      status: (json['status'] ?? 'pending').toString(),
      expiresAt: parsedExpiry,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'agentRunId': agentRunId,
        'actionName': actionName,
        'description': description,
        'payload': payload,
        'token': token,
        'status': status,
        'expiresAt': expiresAt.toIso8601String(),
      };

  @override
  List<Object?> get props => [id, agentRunId, actionName, description, payload, token, status, expiresAt];
}

/// Event types streamed from the Agent backend to client.
enum AgentEventType {
  messageReceived,
  agentStarted,
  textDelta,
  toolCallStarted,
  toolCallFinished,
  confirmationRequired,
  messageCompleted,
  agentFailed;

  static AgentEventType fromString(String value) {
    switch (value.toLowerCase()) {
      case 'message_received':
        return AgentEventType.messageReceived;
      case 'agent_started':
        return AgentEventType.agentStarted;
      case 'text_delta':
      case 'delta':
        return AgentEventType.textDelta;
      case 'tool_call_started':
        return AgentEventType.toolCallStarted;
      case 'tool_call_finished':
        return AgentEventType.toolCallFinished;
      case 'confirmation_required':
        return AgentEventType.confirmationRequired;
      case 'message_completed':
      case 'done':
        return AgentEventType.messageCompleted;
      case 'agent_failed':
      case 'error':
        return AgentEventType.agentFailed;
      default:
        return AgentEventType.textDelta;
    }
  }

  String get asString {
    switch (this) {
      case AgentEventType.messageReceived:
        return 'message_received';
      case AgentEventType.agentStarted:
        return 'agent_started';
      case AgentEventType.textDelta:
        return 'text_delta';
      case AgentEventType.toolCallStarted:
        return 'tool_call_started';
      case AgentEventType.toolCallFinished:
        return 'tool_call_finished';
      case AgentEventType.confirmationRequired:
        return 'confirmation_required';
      case AgentEventType.messageCompleted:
        return 'message_completed';
      case AgentEventType.agentFailed:
        return 'agent_failed';
    }
  }
}

/// A structured event emitted by the Agent Orchestrator.
class AgentEvent extends Equatable {
  final AgentEventType type;
  final String conversationId;
  final String agentRunId;
  final String? textDelta;
  final ToolCallState? toolCall;
  final ConfirmationRequest? confirmationRequest;
  final String? errorMessage;
  final DateTime createdAt;

  const AgentEvent({
    required this.type,
    required this.conversationId,
    required this.agentRunId,
    this.textDelta,
    this.toolCall,
    this.confirmationRequest,
    this.errorMessage,
    required this.createdAt,
  });

  factory AgentEvent.fromJson(Map<String, dynamic> json) {
    return AgentEvent(
      type: AgentEventType.fromString(json['type']?.toString() ?? 'text_delta'),
      conversationId: (json['conversation_id'] ?? json['conversationId'] ?? '').toString(),
      agentRunId: (json['agent_run_id'] ?? json['agentRunId'] ?? '').toString(),
      textDelta: json['text_delta']?.toString() ?? json['delta']?.toString(),
      toolCall: json['tool_call'] is Map
          ? ToolCallState.fromJson(Map<String, dynamic>.from(json['tool_call'] as Map))
          : null,
      confirmationRequest: json['confirmation_request'] is Map
          ? ConfirmationRequest.fromJson(
              Map<String, dynamic>.from(json['confirmation_request'] as Map))
          : null,
      errorMessage: json['error_message']?.toString() ?? json['error']?.toString(),
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
        'type': type.asString,
        'conversationId': conversationId,
        'agentRunId': agentRunId,
        if (textDelta != null) 'textDelta': textDelta,
        if (toolCall != null) 'toolCall': toolCall!.toJson(),
        if (confirmationRequest != null)
          'confirmationRequest': confirmationRequest!.toJson(),
        if (errorMessage != null) 'errorMessage': errorMessage,
        'createdAt': createdAt.toIso8601String(),
      };

  @override
  List<Object?> get props => [
        type,
        conversationId,
        agentRunId,
        textDelta,
        toolCall,
        confirmationRequest,
        errorMessage,
        createdAt,
      ];
}
