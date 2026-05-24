// lib/services/player_api.dart
import 'dart:convert';
/*
import 'package:http/http.dart' as http;

import '../models/player_payload.dart';

class PlayerApi {
  final String baseUrl;

  const PlayerApi({required this.baseUrl});

  Uri playerUri(String pairCode) {
    final cleanBase = baseUrl.replaceAll(RegExp(r'/$'), '');
    return Uri.parse('$cleanBase/api/public/player/$pairCode');
  }

  Future<PlayerPayload> fetchPlayerPayload(String pairCode) async {
    final response = await http.get(playerUri(pairCode));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException('Failed to load player payload (${response.statusCode})');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is Map<String, dynamic>) {
      return PlayerPayload.fromJson(decoded);
    }
    if (decoded is Map) {
      return PlayerPayload.fromJson(Map<String, dynamic>.from(decoded));
    }
    throw ApiException('Unexpected response from server');
  }
}

class ApiException implements Exception {
  final String message;
  const ApiException(this.message);

  @override
  String toString() => message;
}*/