<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BehavioralCrudTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_create_client_and_see_it_in_list(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->post('/clients', [
            'name' => 'Acme QA Client',
        ]);

        $response->assertRedirect('/clients');
        $this->assertDatabaseHas('clients', ['name' => 'Acme QA Client']);
    }
}
