use crate::sessions::SessionStatus;

impl Default for SessionStatus {
    fn default() -> Self {
        SessionStatus::Idle
    }
}

#[derive(Debug, Clone)]
pub struct SessionStateMachine {
    current: SessionStatus,
}

impl SessionStateMachine {
    pub fn new() -> Self {
        Self {
            current: SessionStatus::Idle,
        }
    }

    pub fn current(&self) -> &SessionStatus {
        &self.current
    }

    pub fn transition(&mut self, new_status: SessionStatus) -> bool {
        // Define valid transitions
        let valid = match (&self.current, &new_status) {
            (SessionStatus::Idle, SessionStatus::Starting) => true,
            (SessionStatus::Starting, SessionStatus::Running) => true,
            (SessionStatus::Starting, SessionStatus::Error) => true,
            (SessionStatus::Running, SessionStatus::WaitingForInput) => true,
            (SessionStatus::Running, SessionStatus::WaitingForApproval) => true,
            (SessionStatus::Running, SessionStatus::Idle) => true,
            (SessionStatus::Running, SessionStatus::Error) => true,
            (SessionStatus::WaitingForInput, SessionStatus::Running) => true,
            (SessionStatus::WaitingForApproval, SessionStatus::Running) => true,
            (SessionStatus::WaitingForApproval, SessionStatus::Idle) => true,
            (SessionStatus::Idle, SessionStatus::Running) => true,
            (SessionStatus::Error, SessionStatus::Idle) => true,
            (SessionStatus::Error, SessionStatus::Running) => true,
            (_, SessionStatus::Archived) => true,
            (_, SessionStatus::Exited) => true,
            _ => false,
        };

        if valid {
            self.current = new_status;
            true
        } else {
            false
        }
    }
}
