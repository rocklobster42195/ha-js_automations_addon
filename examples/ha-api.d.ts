/**
 * This file provides type definitions for the global `ha` object
 * and other functions available in JS Automations scripts.
 */

// --- GLOBAL FUNCTIONS ---

/**
 * Pauses script execution for a specified duration.
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the duration.
 */
declare function sleep(ms: number): Promise<void>;

/**
 * Schedules a cron job.
 * @param expression - A cron expression (e.g., '* * * * *').
 * @param callback - The function to execute.
 * @returns A cron job object that can be stopped.
 */
declare function schedule(expression: string, callback: () => void): any;


// --- TYPE DEFINITIONS ---

/** A filter for state changes in ha.on() */
type ChangeFilter = 'any' | 'ne' | 'eq' | 'gt' | 'ge' | 'lt' | 'le';

/** Represents a Home Assistant state object. */
interface HAState {
    entity_id: EntityID;
    state: string;
    attributes: HAAttributes;
    last_changed: string;
    last_updated: string;
    context: {
        id: string;
        parent_id: string | null;
        user_id: string | null;
    };
}

/** Represents the attributes of a Home Assistant state. */
interface HAAttributes {
    friendly_name?: string;
    icon?: string;
    unit_of_measurement?: string;
    device_class?: string;
    [key: string]: any;
}

/**
 * Represents the data passed to an ha.on() callback.
 */
interface StateChangeData {
    entity_id: EntityID;
    state: any;
    old_state: any;
    attributes: HAAttributes;
}

/**
 * Represents the data passed to an ha.onError() callback for non-fatal background errors.
 */
interface BackgroundErrorData {
    message: string;
    stack?: string;
    type: 'background';
}

// This will be replaced by the dynamically generated list of entities
type EntityID = string;

// This will be replaced by the dynamically generated map of services
type ServiceMap = Record<string, Record<string, any>>;

/**
 * The EntitySelector class provides methods for bulk actions on entities.
 */
declare class EntitySelector {
    list: HAState[];
    count: number;
    where(callback: (entity: HAState) => boolean): EntitySelector;
    each(callback: (entity: HAState) => void): EntitySelector;
    call(service: string, data?: object): EntitySelector;
    turnOn(data?: object): EntitySelector;
    turnOff(data?: object): EntitySelector;
    expand(): EntitySelector;
    toArray(): HAState[];
}


// --- MAIN API OBJECT ---

/**
 * The global `ha` object provides the main API for interacting with Home Assistant.
 */
interface HA {
    // --- Logging ---
    /** Logs a debug message. */
    debug(message: any): void;
    /** Logs an informational message. */
    log(message: any): void;
    /** Logs a warning message. */
    warn(message: any): void;
    /** Logs an error message. */
    error(message: any): void;

    // --- Lifecycle ---
    /** Stops the current script. */
    stop(reason?: string): void;
    /** Restarts the current script. */
    restart(reason?: string): void;

    // --- Services & State ---
    /**
     * Calls a Home Assistant service.
     * @param domain - The service domain (e.g., 'light').
     * @param service - The service name (e.g., 'turn_on').
     * @param data - The service data payload.
     */
    callService<D extends keyof ServiceMap, S extends keyof ServiceMap[D]>(domain: D, service: S, data?: ServiceMap[D][S]): void;
    
    /**
     * Updates the state and/or attributes of an entity.
     * @param entityId - The ID of the entity to update.
     * @param state - The new state.
     * @param attributes - An object of attributes to set.
     */
    update(entityId: string, state: any, attributes?: HAAttributes): void;
    /**
     * Updates the attributes of an entity, keeping its current state.
     * @param entityId - The ID of the entity to update.
     * @param attributes - An object of attributes to set.
     */
    update(entityId: string, attributes: HAAttributes): void;

    /**
     * Registers a new native Home Assistant entity.
     * @param entityId - The desired entity ID (e.g., 'sensor.my_sensor').
     * @param config - The entity configuration.
     */
    register(entityId: string, config?: HAAttributes & { name?: string; unit?: string; initial_state?: any; device?: 'script' | 'system' | 'none' }): void;

    // --- Data Access ---
    /** A cache of all Home Assistant states. */
    readonly states: Record<EntityID, HAState>;
    /** Gets the full state object for an entity. */
    getState(entityId: EntityID): HAState | undefined;
    /** Gets a specific attribute from an entity. */
    getAttr(entityId: EntityID, attribute: string): any | undefined;
    /** Gets the state value of an entity, with type conversion. */
    getStateValue(entityId: EntityID): any | undefined;
    /** Gets the member entity IDs of a group. */
    getGroupMembers(entityId: EntityID): string[];
    /** Reads a value from the script's header block. */
    getHeader(key: string, defaultValue?: any): any;

    // --- Selectors ---
    /** Selects multiple entities based on a pattern. */
    select(pattern: string | RegExp | string[]): EntitySelector;

    // --- Events & Triggers ---
    /** Listens for state changes on one or more entities. */
    on(pattern: string | RegExp | string[], callback: (data: StateChangeData) => void): void;
    /** Listens for state changes with an additional filter. */
    on(pattern: string | RegExp | string[], filter: ChangeFilter, callback: (data: StateChangeData) => void): void;
    /** Listens for state changes against a specific threshold. */
    on(pattern: string | RegExp | string[], filter: ChangeFilter, threshold: string | number, callback: (data: StateChangeData) => void): void;

    /** Registers a cleanup function to be called when the script is stopped. */
    onStop(callback: () => Promise<void> | void): void;

    /**
     * Registers a handler for non-fatal background errors.
     * This is used to catch errors from underlying libraries (e.g., WebSocket disconnects)
     * that are suppressed by the wrapper to prevent a full script crash.
     * @param callback - A function to execute when a background error occurs.
     */
    onError(callback: (error: BackgroundErrorData) => void): void;

    // --- Persistent Store ---
    store: {
        /** The current values in the store. */
        readonly val: Record<string, any>;
        /** Sets a value in the persistent store. */
        set(key: string, value: any, isSecret?: boolean): void;
        /** Gets a value from the persistent store. */
        get(key: string): any;
        /** Deletes a key-value pair from the store. */
        delete(key: string): void;
        /** Listens for changes to a specific key in the store. */
        on(key: string, callback: (newValue: any, oldValue: any) => void): void;
    };
}

declare global {
    const ha: HA;
}

// This is needed to make it a module
export {};