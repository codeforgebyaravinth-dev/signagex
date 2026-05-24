// lib/models/player_settings.dart
/**class PlayerSettings {
  final String backendUrl;
  final String? pairCode;
  final String orientationMode;
  final String mediaMode;

  const PlayerSettings({
    required this.backendUrl,
    required this.pairCode,
    required this.orientationMode,
    required this.mediaMode,
  });

  PlayerSettings copyWith({
    String? backendUrl,
    String? pairCode,
    String? orientationMode,
    String? mediaMode,
  }) {
    return PlayerSettings(
      backendUrl: backendUrl ?? this.backendUrl,
      pairCode: pairCode ?? this.pairCode,
      orientationMode: orientationMode ?? this.orientationMode,
      mediaMode: mediaMode ?? this.mediaMode,
    );
  }

  factory PlayerSettings.defaults() {
    return const PlayerSettings(
      backendUrl: 'http://10.0.2.2:8000',
      pairCode: null,
      orientationMode: 'auto',
      mediaMode: 'fit',
    );
  }
}*/