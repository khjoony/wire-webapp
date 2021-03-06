/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

'use strict';

window.z = window.z || {};
window.z.conversation = z.conversation || {};

// Conversation Mapper to convert all server side JSON conversation objects into core entities
z.conversation.ConversationMapper = class ConversationMapper {
  // Construct a new Conversation Mapper.
  constructor() {
    this.logger = new z.util.Logger('z.conversation.ConversationMapper', z.config.LOGGER.OPTIONS);
  }

  /**
   * Converts JSON conversations into conversation entities.
   *
   * @param {Array} [conversations=[undefined]] - Conversation data
   * @param {number} [timestamp=1] - Initial timestamp for conversation
   * @returns {Array<Conversation>} Mapped conversation entities
   */
  map_conversations(conversations = [undefined], timestamp = 1) {
    return conversations.map((conversation, index) => this._create_conversation_et(conversation, timestamp + index));
  }

  /**
   * Updates all properties of a conversation specified
   *
   * @example data: {"name":"ThisIsMyNewConversationName"}
   * @todo make utility?
   *
   * @param {Conversation} conversation_et - Conversation to be updated
   * @param {Object} conversation_data - Conversation data
   * @returns {Conversation} Updated conversation entity
   */
  update_properties(conversation_et, conversation_data) {
    for (const key in conversation_data) {
      if (key !== 'id' && conversation_et.hasOwnProperty(key)) {
        const value = conversation_data[key];

        if (value !== undefined) {
          if (ko.isObservable(conversation_et[key])) {
            conversation_et[key](value);
          } else {
            conversation_et[key] = value;
          }
        }
      }
    }

    return conversation_et;
  }

  /**
   * Update the membership properties of a conversation.
   *
   * @param {Conversation} conversation_et - Conversation to be updated
   * @param {Object} self_state - Conversation self data
   * @returns {Conversation} Updated conversation entity
   */
  update_self_status(conversation_et, self_state) {
    if (conversation_et) {
      // Database states
      const {
        archived_timestamp,
        cleared_timestamp,
        ephemeral_timer,
        last_event_timestamp,
        last_read_timestamp,
        last_server_timestamp,
        muted_timestamp,
        status,
        verification_state,
      } = self_state;

      if (archived_timestamp) {
        conversation_et.set_timestamp(archived_timestamp, z.conversation.TIMESTAMP_TYPE.ARCHIVED);
        conversation_et.archived_state(self_state.archived_state);
      }

      if (cleared_timestamp) {
        conversation_et.set_timestamp(cleared_timestamp, z.conversation.TIMESTAMP_TYPE.CLEARED);
      }

      if (ephemeral_timer !== undefined) {
        conversation_et.ephemeral_timer(ephemeral_timer);
      }

      if (last_event_timestamp) {
        conversation_et.set_timestamp(last_event_timestamp, z.conversation.TIMESTAMP_TYPE.LAST_EVENT);
      }

      if (last_read_timestamp) {
        conversation_et.set_timestamp(last_read_timestamp, z.conversation.TIMESTAMP_TYPE.LAST_READ);
      }

      if (last_server_timestamp) {
        conversation_et.set_timestamp(last_server_timestamp, z.conversation.TIMESTAMP_TYPE.LAST_SERVER);
      }

      if (muted_timestamp) {
        conversation_et.set_timestamp(muted_timestamp, z.conversation.TIMESTAMP_TYPE.MUTED);
        conversation_et.muted_state(self_state.muted_state);
      }

      if (status !== undefined) {
        conversation_et.status(status);
      }

      if (verification_state !== undefined) {
        conversation_et.verification_state(verification_state);
      }

      // Backend states
      const {otr_archived, otr_muted} = self_state;

      if (otr_archived !== undefined) {
        const otr_archived_timestamp = new Date(self_state.otr_archived_ref).getTime();
        conversation_et.set_timestamp(otr_archived_timestamp, z.conversation.TIMESTAMP_TYPE.ARCHIVED);
        conversation_et.archived_state(otr_archived);
      }

      if (otr_muted !== undefined) {
        const otr_muted_timestamp = new Date(self_state.otr_muted_ref).getTime();
        conversation_et.set_timestamp(otr_muted_timestamp, z.conversation.TIMESTAMP_TYPE.MUTED);
        conversation_et.muted_state(otr_muted);
      }

      return conversation_et;
    }
  }

  /**
   * Creates a conversation entity from backend JSON data.
   *
   * @private
   * @param {Object} conversation_data - Either locally stored or backend data
   * @param {number} [initial_timestamp] - Initial timestamp for conversation in milliseconds
   * @returns {Conversation} Mapped conversation entity
   */
  _create_conversation_et(conversation_data, initial_timestamp) {
    if (conversation_data === undefined || !Object.keys(conversation_data).length) {
      throw new Error('Cannot create conversation entity without data');
    }

    const {creator, id, members, name, others, type} = conversation_data;
    let conversation_et = new z.entity.Conversation(id);

    conversation_et.creator = creator;
    conversation_et.type(type);
    conversation_et.name(name ? name : '');

    const self_state = members ? members.self : conversation_data;
    conversation_et = this.update_self_status(conversation_et, self_state);

    if (!conversation_et.last_event_timestamp() && initial_timestamp) {
      conversation_et.last_event_timestamp(initial_timestamp);
      conversation_et.last_server_timestamp(initial_timestamp);
    }

    // Active participants from database or backend payload
    const participatingUserIds = others ? others : members.others.map(other => other.id);
    conversation_et.participating_user_ids(participatingUserIds);

    // Team ID from database or backend payload
    const team_id = conversation_data.team_id ? conversation_data.team_id : conversation_data.team;
    if (team_id) {
      conversation_et.team_id = team_id;
    }

    if (conversation_data.is_guest) {
      conversation_et.isGuest(conversation_data.is_guest);
    }

    // Access related data
    const accessModes = conversation_data.accessModes ? conversation_data.accessModes : conversation_data.access;
    const accessRole = conversation_data.accessRole ? conversation_data.accessRole : conversation_data.access_role;
    if (accessModes && accessRole) {
      this.mapAccessState(conversation_et, accessModes, accessRole);
    }

    return conversation_et;
  }

  /**
   * Merge local database records with remote backend payload.
   * @param {Array} local - Database records
   * @param {Array} remote - Backend payload
   * @returns {Array} Merged conversation data
   */
  merge_conversations(local, remote) {
    return remote.map((remote_conversation, index) => {
      const {access, access_role, id, creator, members, name, team, type} = remote_conversation;
      let local_conversation = local.filter(conversation => conversation).find(conversation => conversation.id === id);

      if (!local_conversation) {
        local_conversation = {
          id: id,
        };
      }

      local_conversation.accessModes = access;
      local_conversation.accessRole = access_role;
      local_conversation.creator = creator;
      local_conversation.name = name;
      local_conversation.status = members.self.status;
      local_conversation.team_id = team;
      local_conversation.type = type;

      local_conversation.others = members.others
        .filter(other => other.status === z.conversation.ConversationStatus.CURRENT_MEMBER)
        .map(other => other.id);

      // This should ensure a proper order
      if (!local_conversation.last_event_timestamp) {
        local_conversation.last_event_timestamp = index + 1;
      }

      // Set initially or correct server timestamp
      const wrong_server_timestamp = local_conversation.last_server_timestamp < local_conversation.last_event_timestamp;
      if (!local_conversation.last_server_timestamp || wrong_server_timestamp) {
        local_conversation.last_server_timestamp = local_conversation.last_event_timestamp;
      }

      // Some archived timestamp were not properly stored in the database.
      // To fix this we check if the remote one is newer and update our local timestamp.
      const {archived_state: local_archived_state, archived_timestamp: local_archived_timestamp} = local_conversation;
      const remote_archived_timestamp = new Date(members.self.otr_archived_ref).getTime();
      const is_remote_archived_timestamp_newer =
        local_archived_timestamp !== undefined && remote_archived_timestamp > local_archived_timestamp;

      if (is_remote_archived_timestamp_newer || local_archived_state === undefined) {
        local_conversation.archived_state = members.self.otr_archived;
        local_conversation.archived_timestamp = remote_archived_timestamp;
      }

      const {muted_state: local_muted_state, muted_timestamp: local_muted_timestamp} = local_conversation;
      const remote_muted_timestamp = new Date(members.self.otr_muted_ref).getTime();
      const is_remote_muted_timestamp_newer =
        local_muted_timestamp !== undefined && remote_muted_timestamp > local_muted_timestamp;

      if (is_remote_muted_timestamp_newer || local_muted_state === undefined) {
        local_conversation.muted_state = members.self.otr_muted;
        local_conversation.muted_timestamp = remote_muted_timestamp;
      }

      return local_conversation;
    });
  }

  mapAccessCode(conversationEntity, accessCode) {
    const isTeamConversation = conversationEntity && conversationEntity.team_id;
    if (isTeamConversation) {
      if (z.util.Environment.frontend.isInternal()) {
        const accessLink = `${z.config.URL.WEBAPP.INTERNAL}/join/?key=${accessCode.key}&code=${accessCode.code}`;
        return conversationEntity.accessCode(accessLink);
      }

      conversationEntity.accessCode(accessCode.uri);
    }
  }

  mapAccessState(conversationEntity, accessModes, accessRole) {
    if (conversationEntity.team_id) {
      if (conversationEntity.is_one2one()) {
        return conversationEntity.accessState(z.conversation.ACCESS_STATE.TEAM.ONE2ONE);
      }

      const isTeamRole = accessRole === z.conversation.ACCESS_ROLE.TEAM;

      const includesInviteMode = accessModes.includes(z.conversation.ACCESS_MODE.INVITE);
      const isInviteModeOnly = includesInviteMode && accessModes.length === 1;

      const isTeamOnlyMode = isTeamRole && isInviteModeOnly;
      if (isTeamOnlyMode) {
        return conversationEntity.accessState(z.conversation.ACCESS_STATE.TEAM.TEAM_ONLY);
      }

      const isNonVerifiedRole = accessRole === z.conversation.ACCESS_ROLE.NON_ACTIVATED;

      const includesCodeMode = accessModes.includes(z.conversation.ACCESS_MODE.CODE);
      const isExpectedModes = includesCodeMode && includesInviteMode && accessModes.length === 2;

      const isGuestRoomMode = isNonVerifiedRole && isExpectedModes;
      if (isGuestRoomMode) {
        return conversationEntity.accessState(z.conversation.ACCESS_STATE.TEAM.GUEST_ROOM);
      }

      return conversationEntity.accessState(z.conversation.ACCESS_STATE.TEAM.LEGACY);
    }

    if (conversationEntity.is_self()) {
      return conversationEntity.accessState(z.conversation.ACCESS_STATE.SELF);
    }

    const personalAccessState = conversationEntity.is_group()
      ? z.conversation.ACCESS_STATE.PERSONAL.GROUP
      : z.conversation.ACCESS_STATE.PERSONAL.ONE2ONE;
    return conversationEntity.accessState(personalAccessState);
  }
};
